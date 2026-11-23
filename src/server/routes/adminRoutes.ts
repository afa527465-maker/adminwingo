import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  bets,
  depositRequests,
  gameRounds,
  gameRulesets,
  ledgerTransactions,
  platformSettings,
  sessions,
  supportTickets,
  users,
  wallets,
  withdrawalRequests,
} from '../../db/schema.ts';
import { ensureWallet, recordAuditLog } from '../ledger.ts';
import {
  getActiveRuleset,
  getLiveModeState,
  getPausedModes,
  invalidateRulesetCache,
  settleDueRounds,
} from '../roundManager.ts';
import { WINGO_MODES, type WinGoMode } from '../rules.ts';
import { generateInviteCode, hashPassword } from '../crypto.ts';
import { requireAdmin, requireAuth, sanitizeUserProfile, type AuthenticatedRequest } from '../auth.ts';
import { adminFinanceSystemRouter } from './adminFinanceSystemRoutes.ts';

export const adminRouter = Router();

// Every admin route requires authenticated backend session + valid admin RBAC role
adminRouter.use(requireAuth, requireAdmin());

// =========================================================================
// 1. DASHBOARD KPIs, RECENT TRANSACTIONS & LIVE GAME STATUS
// =========================================================================
adminRouter.get('/dashboard', async (_req, res) => {
  try {
    await settleDueRounds();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      playerStats,
      activeTodayStats,
      pendingDepStats,
      pendingWdStats,
      ticketStats,
      betStats,
      depCompleted,
      wdCompleted,
      recentTransactions,
      live30s,
      live1m,
      live3m,
      live5m,
    ] = await Promise.all([
      db
        .select({
          totalPlayers: sql<number>`count(*)::int`,
          activePlayers: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
          suspendedPlayers: sql<number>`count(*) filter (where ${users.status} = 'suspended')::int`,
          vipMembers: sql<number>`count(*) filter (where ${users.vipLevel} > 0)::int`,
        })
        .from(users)
        .where(sql`${users.role} IN ('player', 'agent')`),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(sql`${users.role} IN ('player', 'agent')`, gte(users.lastLoginAt, todayStart))),
      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`COALESCE(SUM(${depositRequests.amount}), 0)::numeric(18,2)::text`,
        })
        .from(depositRequests)
        .where(eq(depositRequests.status, 'pending')),
      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`COALESCE(SUM(${withdrawalRequests.amount}), 0)::numeric(18,2)::text`,
        })
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.status, 'pending')),
      db
        .select({ openTickets: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(or(eq(supportTickets.status, 'open'), eq(supportTickets.status, 'in_progress'))),
      db
        .select({
          totalBets: sql<number>`count(*)::int`,
          totalWagered: sql<string>`COALESCE(SUM(${bets.totalStake}), 0)::numeric(18,2)::text`,
          totalPayout: sql<string>`COALESCE(SUM(${bets.actualPayout}), 0)::numeric(18,2)::text`,
        })
        .from(bets),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${depositRequests.amount}), 0)::numeric(18,2)::text`,
        })
        .from(depositRequests)
        .where(eq(depositRequests.status, 'completed')),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${withdrawalRequests.amount}), 0)::numeric(18,2)::text`,
        })
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.status, 'completed')),
      db
        .select({
          tx: ledgerTransactions,
          userName: users.displayName,
          username: users.username,
        })
        .from(ledgerTransactions)
        .leftJoin(users, eq(ledgerTransactions.userId, users.id))
        .orderBy(desc(ledgerTransactions.createdAt))
        .limit(12),
      getLiveModeState('30s'),
      getLiveModeState('1m'),
      getLiveModeState('3m'),
      getLiveModeState('5m'),
    ]);

    const totalWagered = parseFloat(betStats[0]?.totalWagered || '0');
    const totalPayout = parseFloat(betStats[0]?.totalPayout || '0');
    const ggr = (totalWagered - totalPayout).toFixed(2);
    const ruleset = await getActiveRuleset();

    return res.json({
      kpis: {
        totalPlayers: playerStats[0]?.totalPlayers || 0,
        activePlayers: playerStats[0]?.activePlayers || 0,
        activeToday: activeTodayStats[0]?.count || 0,
        suspendedPlayers: playerStats[0]?.suspendedPlayers || 0,
        vipMembers: playerStats[0]?.vipMembers || 0,
        pendingDepositsCount: pendingDepStats[0]?.count || 0,
        pendingDepositsAmount: pendingDepStats[0]?.total || '0.00',
        pendingWithdrawalsCount: pendingWdStats[0]?.count || 0,
        pendingWithdrawalsAmount: pendingWdStats[0]?.total || '0.00',
        openSupportTickets: ticketStats[0]?.openTickets || 0,
        totalBets: betStats[0]?.totalBets || 0,
        totalWagered: betStats[0]?.totalWagered || '0.00',
        totalPayout: betStats[0]?.totalPayout || '0.00',
        grossGamingRevenue: ggr,
        completedDeposits: depCompleted[0]?.total || '0.00',
        completedWithdrawals: wdCompleted[0]?.total || '0.00',
      },
      recentTransactions: recentTransactions.map((r) => ({
        ...r.tx,
        userName: r.userName,
        username: r.username,
      })),
      liveGames: [live30s, live1m, live3m, live5m].map((g) => ({
        mode: g.mode,
        label: g.modeConfig.label,
        modePaused: g.modePaused,
        currentRound: g.currentRound,
      })),
      activeRuleset: {
        version: ruleset.version,
        ownerApprovedForProd: ruleset.ownerApprovedForProd,
      },
      mode: process.env.WINGO_MODE || 'development',
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load admin dashboard.' });
  }
});

// =========================================================================
// 2. PLAYER MANAGEMENT (MULTI-FIELD FILTER, CRUD, VERIFY, SUSPEND, RESET)
// =========================================================================
adminRouter.get('/players', async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  const username = String(req.query.username || '').trim();
  const phone = String(req.query.phone || '').trim();
  const email = String(req.query.email || '').trim();
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || 'all');
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  try {
    const conditions = [sql`${users.role} IN ('player', 'agent')`];

    if (userId) {
      const numericId = parseInt(userId.replace(/[^\d]/g, ''), 10);
      if (Number.isInteger(numericId)) {
        conditions.push(eq(users.id, numericId));
      } else {
        conditions.push(ilike(users.uid, `%${userId}%`));
      }
    }
    if (username) {
      conditions.push(
        or(ilike(users.username, `%${username}%`), ilike(users.displayName, `%${username}%`))!
      );
    }
    if (phone) conditions.push(ilike(users.phone, `%${phone}%`));
    if (email) conditions.push(ilike(users.email, `%${email}%`));
    if (search) {
      conditions.push(
        or(
          ilike(users.displayName, `%${search}%`),
          ilike(users.username, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.phone, `%${search}%`),
          ilike(users.inviteCode, `%${search}%`)
        )!
      );
    }
    if (status === 'pending') {
      conditions.push(sql`${users.status} IN ('pending_approval', 'pending_verification')`);
    } else if (['active', 'pending_approval', 'pending_verification', 'rejected', 'suspended'].includes(status)) {
      conditions.push(eq(users.status, status));
    }
    if (from && !Number.isNaN(Date.parse(from))) {
      conditions.push(gte(users.createdAt, new Date(from)));
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(users.createdAt, end));
    }

    const rows = await db
      .select({
        user: users,
        wallet: wallets,
      })
      .from(users)
      .leftJoin(wallets, eq(users.id, wallets.userId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(100);

    return res.json({
      items: rows.map((r) => ({
        ...sanitizeUserProfile(r.user),
        wallet: r.wallet,
      })),
    });
  } catch (error) {
    console.error('Admin players list error:', error);
    return res.status(500).json({ error: 'Unable to load players.' });
  }
});

adminRouter.get('/players/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid player ID.' });

  try {
    const [player] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!player) return res.status(404).json({ error: 'Player not found.' });

    const [wallet, recentBets, recentTx] = await Promise.all([
      ensureWallet(player.id),
      db.select().from(bets).where(eq(bets.userId, player.id)).orderBy(desc(bets.createdAt)).limit(20),
      db
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.userId, player.id))
        .orderBy(desc(ledgerTransactions.createdAt))
        .limit(20),
    ]);

    return res.json({
      player: sanitizeUserProfile(player),
      wallet,
      recentBets,
      recentTransactions: recentTx,
    });
  } catch (error) {
    console.error('Admin player detail error:', error);
    return res.status(500).json({ error: 'Unable to load player details.' });
  }
});

adminRouter.post(
  '/players',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/).optional().or(z.literal('')),
      displayName: z.string().trim().min(2).max(50),
      email: z.string().trim().email().optional().or(z.literal('')),
      countryCode: z.string().trim().min(1).max(6).default('+91'),
      phone: z.string().trim().min(6).max(20).optional().or(z.literal('')),
      password: z.string().min(8).max(128),
      role: z.enum(['player', 'agent']).default('player'),
      vipLevel: z.number().int().min(0).max(10).default(0),
      isVerified: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid player data.' });
    }

    const d = parsed.data;
    const normalizedEmail = d.email?.trim() ? d.email.trim().toLowerCase() : null;
    const normalizedPhone = d.phone?.trim()
      ? `${d.countryCode}${d.phone.replace(/[^\d]/g, '')}`
      : null;
    const normalizedUsername = d.username?.trim() || null;

    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ error: 'Either an email address or phone number is required.' });
    }
    if (!/[A-Za-z]/.test(d.password) || !/[0-9]/.test(d.password)) {
      return res.status(400).json({ error: 'Password must include both letters and numbers.' });
    }

    try {
      const dupConditions = [];
      if (normalizedEmail) dupConditions.push(eq(users.email, normalizedEmail));
      if (normalizedPhone) dupConditions.push(eq(users.phone, normalizedPhone));
      if (normalizedUsername) {
        dupConditions.push(sql`LOWER(${users.username}) = LOWER(${normalizedUsername})`);
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(dupConditions.length > 1 ? or(...dupConditions) : dupConditions[0])
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: 'A user with this email, phone, or username already exists.' });
      }

      const [created] = await db
        .insert(users)
        .values({
          uid: `local_${crypto.randomUUID()}`,
          username: normalizedUsername,
          displayName: d.displayName,
          email: normalizedEmail,
          countryCode: d.countryCode,
          phone: normalizedPhone,
          passwordHash: hashPassword(d.password),
          role: d.role,
          vipLevel: d.vipLevel,
          status: d.isVerified ? 'active' : 'pending_verification',
          isVerified: d.isVerified,
          ageConfirmed: true,
          jurisdictionCode: 'GLOBAL',
          inviteCode: generateInviteCode(),
        })
        .returning();

      const wallet = await ensureWallet(created.id);

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.player_created',
        entityType: 'user',
        entityId: String(created.id),
        details: { role: created.role, email: created.email, phone: created.phone },
        ipAddress: req.ip,
      });

      return res.status(201).json({ player: sanitizeUserProfile(created), wallet });
    } catch (error) {
      console.error('Admin create player error:', error);
      return res.status(500).json({ error: 'Unable to create player account.' });
    }
  }
);

adminRouter.patch(
  '/players/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({
      status: z.enum(['active', 'pending_approval', 'pending_verification', 'rejected', 'suspended']).optional(),
      role: z.enum(['player', 'agent']).optional(),
      isVerified: z.boolean().optional(),
      displayName: z.string().trim().min(2).max(50).optional(),
      vipLevel: z.number().int().min(0).max(10).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid player update payload.' });
    }

    try {
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return res.status(404).json({ error: 'Player not found.' });
      if (['super_admin', 'admin', 'finance', 'support'].includes(target.role)) {
        return res.status(403).json({ error: 'Use Administrator Management to update staff accounts.' });
      }

      const updates: Partial<typeof users.$inferInsert> = {};
      if (parsed.data.status) updates.status = parsed.data.status;
      if (parsed.data.role) updates.role = parsed.data.role;
      if (parsed.data.isVerified !== undefined) {
        updates.isVerified = parsed.data.isVerified;
        if (parsed.data.isVerified && !parsed.data.status && target.status === 'pending_verification') {
          updates.status = 'active';
        }
      }
      if (parsed.data.displayName) updates.displayName = parsed.data.displayName;
      if (parsed.data.vipLevel !== undefined) updates.vipLevel = parsed.data.vipLevel;

      const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();

      // Immediately revoke active sessions if suspended or rejected
      if (parsed.data.status === 'suspended' || parsed.data.status === 'rejected') {
        await db.delete(sessions).where(eq(sessions.userId, id));
      }

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.player_updated',
        entityType: 'user',
        entityId: String(id),
        details: updates as Record<string, unknown>,
        ipAddress: req.ip,
      });

      return res.json({ player: sanitizeUserProfile(updated) });
    } catch (error) {
      console.error('Admin update player error:', error);
      return res.status(500).json({ error: 'Unable to update player.' });
    }
  }
);

adminRouter.post(
  '/players/:id/approve',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid player ID.' });
    }

    try {
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return res.status(404).json({ error: 'Player not found.' });
      if (['super_admin', 'admin', 'finance', 'support'].includes(target.role)) {
        return res.status(403).json({ error: 'Use Administrator Management to update staff accounts.' });
      }

      const approvedAt = new Date();
      // Keep isVerified separate so phone/email verification remains false until genuinely verified
      const [updated] = await db
        .update(users)
        .set({
          status: 'active',
          approvedByUserId: req.authUser!.id,
          approvedAt,
          rejectionReason: null,
        })
        .where(eq(users.id, id))
        .returning();

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.player_approved',
        entityType: 'user',
        entityId: String(id),
        details: {
          previousStatus: target.status,
          newStatus: 'active',
          phoneVerified: target.isVerified,
          approvedBy: req.authUser!.username || req.authUser!.email,
          approvedAt: approvedAt.toISOString(),
        },
        ipAddress: req.ip,
      });

      return res.json({ player: sanitizeUserProfile(updated) });
    } catch (error) {
      console.error('Admin approve player error:', error);
      return res.status(500).json({ error: 'Unable to approve player.' });
    }
  }
);

adminRouter.post(
  '/players/:id/reject',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({
      reason: z.string().trim().max(240).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid player rejection request.' });
    }

    try {
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return res.status(404).json({ error: 'Player not found.' });
      if (['super_admin', 'admin', 'finance', 'support'].includes(target.role)) {
        return res.status(403).json({ error: 'Use Administrator Management to update staff accounts.' });
      }

      const reviewedAt = new Date();
      const reason = parsed.data.reason?.trim() || 'Rejected by administrator';

      const [updated] = await db
        .update(users)
        .set({
          status: 'rejected',
          approvedByUserId: req.authUser!.id,
          approvedAt: reviewedAt,
          rejectionReason: reason,
        })
        .where(eq(users.id, id))
        .returning();

      await db.delete(sessions).where(eq(sessions.userId, id));

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.player_rejected',
        entityType: 'user',
        entityId: String(id),
        details: {
          previousStatus: target.status,
          newStatus: 'rejected',
          reason,
          reviewedBy: req.authUser!.username || req.authUser!.email,
          reviewedAt: reviewedAt.toISOString(),
        },
        ipAddress: req.ip,
      });

      return res.json({ player: sanitizeUserProfile(updated) });
    } catch (error) {
      console.error('Admin reject player error:', error);
      return res.status(500).json({ error: 'Unable to reject player.' });
    }
  }
);

adminRouter.post(
  '/players/:id/reset-password',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({
      newPassword: z.string().min(8, 'Password must be at least 8 characters.').max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? 'Invalid player ID.' : parsed.error.issues[0]?.message });
    }
    if (!/[A-Za-z]/.test(parsed.data.newPassword) || !/[0-9]/.test(parsed.data.newPassword)) {
      return res.status(400).json({ error: 'Password must include both letters and numbers.' });
    }

    try {
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return res.status(404).json({ error: 'Player not found.' });
      if (['super_admin', 'admin', 'finance', 'support'].includes(target.role)) {
        return res.status(403).json({ error: 'Cannot reset administrator password from player endpoint.' });
      }

      await db
        .update(users)
        .set({ passwordHash: hashPassword(parsed.data.newPassword) })
        .where(eq(users.id, id));
      await db.delete(sessions).where(eq(sessions.userId, id));

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.player_password_reset',
        entityType: 'user',
        entityId: String(id),
        ipAddress: req.ip,
      });

      return res.json({ message: 'Player password updated and existing sessions revoked.' });
    } catch (error) {
      console.error('Admin reset player password error:', error);
      return res.status(500).json({ error: 'Unable to reset player password.' });
    }
  }
);

// =========================================================================
// 3. ADMINISTRATOR MANAGEMENT (SUPER ADMIN ONLY FOR MUTATIONS)
// =========================================================================
adminRouter.get('/admins', requireAdmin(['super_admin', 'admin']), async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(sql`${users.role} IN ('super_admin', 'admin', 'finance', 'support')`)
      .orderBy(users.id);

    return res.json({ items: rows.map(sanitizeUserProfile) });
  } catch (error) {
    console.error('Admin list error:', error);
    return res.status(500).json({ error: 'Unable to load administrators.' });
  }
});

adminRouter.post('/admins', requireAdmin(['super_admin']), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/),
    email: z.string().trim().email().optional().or(z.literal('')),
    displayName: z.string().trim().min(2).max(50),
    password: z.string().min(10, 'Administrator password must be at least 10 characters.').max(128),
    role: z.enum(['admin', 'finance', 'support']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid administrator payload.' });
  }
  if (!/[A-Za-z]/.test(parsed.data.password) || !/[0-9]/.test(parsed.data.password)) {
    return res.status(400).json({ error: 'Password must include both letters and numbers.' });
  }

  try {
    const normalizedEmail = parsed.data.email?.trim() ? parsed.data.email.trim().toLowerCase() : null;
    const dupConds = [sql`LOWER(${users.username}) = LOWER(${parsed.data.username})`];
    if (normalizedEmail) dupConds.push(eq(users.email, normalizedEmail));

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(dupConds.length > 1 ? or(...dupConds) : dupConds[0])
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this username or email already exists.' });
    }

    const [created] = await db
      .insert(users)
      .values({
        uid: `admin_${crypto.randomUUID()}`,
        username: parsed.data.username,
        email: normalizedEmail,
        displayName: parsed.data.displayName,
        passwordHash: hashPassword(parsed.data.password),
        role: parsed.data.role,
        status: 'active',
        isVerified: true,
        ageConfirmed: true,
        jurisdictionCode: 'GLOBAL',
        inviteCode: generateInviteCode(),
      })
      .returning();

    await ensureWallet(created.id);

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.username || req.authUser!.email,
      action: 'admin.staff_created',
      entityType: 'user',
      entityId: String(created.id),
      details: { username: created.username, role: created.role },
      ipAddress: req.ip,
    });

    return res.status(201).json({ admin: sanitizeUserProfile(created) });
  } catch (error) {
    console.error('Create admin error:', error);
    return res.status(500).json({ error: 'Unable to create administrator account.' });
  }
});

adminRouter.patch('/admins/:id', requireAdmin(['super_admin']), async (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    role: z.enum(['super_admin', 'admin', 'finance', 'support']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: 'Invalid administrator update payload.' });
  }

  try {
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: 'Administrator not found.' });

    // Protect primary Super Admin Afa and current actor from self-lockout
    if (target.id === req.authUser!.id && (parsed.data.status === 'suspended' || (parsed.data.role && parsed.data.role !== 'super_admin'))) {
      return res.status(400).json({ error: 'You cannot demote or suspend your own active Super Administrator account.' });
    }
    if (target.username?.toLowerCase() === 'afa' && parsed.data.status === 'suspended') {
      return res.status(400).json({ error: 'Primary Super Administrator "Afa" cannot be suspended.' });
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      })
      .where(eq(users.id, id))
      .returning();

    if (parsed.data.status === 'suspended') {
      await db.delete(sessions).where(eq(sessions.userId, id));
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.username || req.authUser!.email,
      action: 'admin.staff_updated',
      entityType: 'user',
      entityId: String(id),
      details: parsed.data,
      ipAddress: req.ip,
    });

    return res.json({ admin: sanitizeUserProfile(updated) });
  } catch (error) {
    console.error('Update admin error:', error);
    return res.status(500).json({ error: 'Unable to update administrator.' });
  }
});

// =========================================================================
// 4. GAME MANAGEMENT (VERSIONED RULESETS & APPROVAL)
// =========================================================================
adminRouter.get('/games/overview', async (_req, res) => {
  try {
    await settleDueRounds();
    const [rulesets, pausedModes] = await Promise.all([
      db.select().from(gameRulesets).orderBy(desc(gameRulesets.id)).limit(20),
      getPausedModes(),
    ]);

    const modes: WinGoMode[] = ['30s', '1m', '3m', '5m'];
    const liveModes = await Promise.all(modes.map((m) => getLiveModeState(m)));

    return res.json({
      rulesets,
      pausedModes,
      liveModes: liveModes.map((l) => ({
        mode: l.mode,
        label: l.modeConfig.label,
        durationSeconds: l.modeConfig.durationSeconds,
        cutoffSeconds: l.modeConfig.cutoffSeconds,
        modePaused: l.modePaused,
        currentRound: l.currentRound,
      })),
    });
  } catch (error) {
    console.error('Admin games overview error:', error);
    return res.status(500).json({ error: 'Unable to load games overview.' });
  }
});

adminRouter.post(
  '/rulesets',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      version: z.string().trim().min(3).max(40),
      notes: z.string().trim().max(300).optional(),
      feePercent: z.number().min(0).max(15),
      minWager: z.number().positive(),
      maxWager: z.number().positive(),
      payoutMultipliers: z.object({
        colorStandard: z.number().positive(),
        colorSplitViolet: z.number().positive(),
        violet: z.number().positive(),
        numberExact: z.number().positive(),
        bigSmall: z.number().positive(),
      }),
      commissionRates: z.object({
        tier1Percent: z.number().min(0).max(10),
        tier2Percent: z.number().min(0).max(5),
      }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ruleset configuration.' });
    }

    const active = await getActiveRuleset();
    const nextConfig = {
      ...active.config,
      feePercent: parsed.data.feePercent,
      minWager: parsed.data.minWager,
      maxWager: parsed.data.maxWager,
      payoutMultipliers: parsed.data.payoutMultipliers,
      commissionRates: parsed.data.commissionRates,
    };

    try {
      const created = await db.transaction(async (tx) => {
        await tx.update(gameRulesets).set({ isActive: false });
        const [row] = await tx
          .insert(gameRulesets)
          .values({
            version: parsed.data.version,
            isActive: true,
            ownerApprovedForProd: false,
            configJson: nextConfig,
            notes: parsed.data.notes || 'Created via WinGo Admin Panel',
          })
          .returning();
        return row;
      });

      invalidateRulesetCache();

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.ruleset_created',
        entityType: 'game_ruleset',
        entityId: created.version,
        details: { feePercent: parsed.data.feePercent, payouts: parsed.data.payoutMultipliers },
        ipAddress: req.ip,
      });

      return res.status(201).json({ ruleset: created });
    } catch (error: any) {
      if (String(error?.message || '').includes('unique')) {
        return res.status(409).json({ error: 'A ruleset with this version name already exists.' });
      }
      console.error('Create ruleset error:', error);
      return res.status(500).json({ error: 'Unable to create ruleset.' });
    }
  }
);

adminRouter.post(
  '/rulesets/:id/approve',
  requireAdmin(['super_admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ruleset ID.' });

    try {
      const [updated] = await db
        .update(gameRulesets)
        .set({
          ownerApprovedForProd: true,
          approvedByUserId: req.authUser!.id,
          approvedAt: new Date(),
        })
        .where(eq(gameRulesets.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Ruleset not found.' });
      invalidateRulesetCache();

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.ruleset_approved_for_prod',
        entityType: 'game_ruleset',
        entityId: updated.version,
        ipAddress: req.ip,
      });

      return res.json({ ruleset: updated });
    } catch (error) {
      console.error('Approve ruleset error:', error);
      return res.status(500).json({ error: 'Unable to approve ruleset.' });
    }
  }
);

// =========================================================================
// 5. ROUND MANAGEMENT (NO OUTCOME MANIPULATION — TRANSPARENT OPERATIONS ONLY)
// =========================================================================
adminRouter.get('/rounds', async (req, res) => {
  const mode = String(req.query.mode || 'all');
  const status = String(req.query.status || 'all');
  try {
    await settleDueRounds();
    const conditions = [];
    if (mode !== 'all' && WINGO_MODES[mode as WinGoMode]) {
      conditions.push(eq(gameRounds.mode, mode));
    }
    if (['open', 'closed', 'settled'].includes(status)) {
      conditions.push(eq(gameRounds.status, status));
    }

    const items = await db
      .select()
      .from(gameRounds)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(gameRounds.endsAt))
      .limit(100);

    const pausedModes = await getPausedModes();
    return res.json({ items, pausedModes });
  } catch (error) {
    console.error('Admin rounds error:', error);
    return res.status(500).json({ error: 'Unable to load rounds.' });
  }
});

adminRouter.patch(
  '/games/mode-status',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      mode: z.enum(['30s', '1m', '3m', '5m']),
      paused: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid mode status request.' });

    try {
      const current = await getPausedModes();
      const next = { ...current, [parsed.data.mode]: parsed.data.paused };
      await db
        .insert(platformSettings)
        .values({
          key: 'paused_modes',
          valueJson: next,
          updatedByUserId: req.authUser!.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { valueJson: next, updatedByUserId: req.authUser!.id, updatedAt: new Date() },
        });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: parsed.data.paused ? 'admin.mode_paused' : 'admin.mode_resumed',
        entityType: 'game_mode',
        entityId: parsed.data.mode,
        details: { paused: parsed.data.paused },
        ipAddress: req.ip,
      });

      return res.json({ pausedModes: next });
    } catch (error) {
      console.error('Admin toggle mode error:', error);
      return res.status(500).json({ error: 'Unable to update game mode status.' });
    }
  }
);

// =========================================================================
// 6. OFFICIAL RESULT MONITORING (SERVER-CONTROLLED FAIR DRAW — ZERO RIGGING)
// =========================================================================
adminRouter.get('/results', async (req, res) => {
  const mode = (String(req.query.mode || '1m') as WinGoMode);
  const safeMode: WinGoMode = WINGO_MODES[mode] ? mode : '1m';

  try {
    const liveState = await getLiveModeState(safeMode);

    // Aggregate current round exposure by bet category + selection (transparent monitoring only)
    const currentExposure = await db
      .select({
        category: bets.category,
        selection: bets.selection,
        betCount: sql<number>`count(*)::int`,
        totalStake: sql<string>`COALESCE(SUM(${bets.totalStake}), 0)::numeric(18,2)::text`,
        potentialPayout: sql<string>`COALESCE(SUM(${bets.potentialPayout}), 0)::numeric(18,2)::text`,
      })
      .from(bets)
      .where(eq(bets.periodId, liveState.currentRound.periodId))
      .groupBy(bets.category, bets.selection)
      .orderBy(desc(sql`SUM(${bets.totalStake})`));

    const recentSettled = await db
      .select()
      .from(gameRounds)
      .where(and(eq(gameRounds.mode, safeMode), eq(gameRounds.status, 'settled')))
      .orderBy(desc(gameRounds.endsAt))
      .limit(30);

    return res.json({
      mode: safeMode,
      modePaused: liveState.modePaused,
      serverTimeMs: liveState.serverTimeMs,
      currentRound: liveState.currentRound,
      currentExposure,
      recentSettled,
      integrityNotice:
        'All WinGo results are derived strictly from pre-committed CSPRNG SHA-256 server seeds. Manual outcome manipulation or retrospective modification of settled results is permanently disabled.',
    });
  } catch (error) {
    console.error('Admin official results error:', error);
    return res.status(500).json({ error: 'Unable to load official result monitoring data.' });
  }
});

// =========================================================================
// 7 & 8. BETTING ORDERS (LIVE/PENDING) & BETTING HISTORY (SETTLED)
// =========================================================================
adminRouter.get('/bets', async (req, res) => {
  const scope = String(req.query.scope || 'all'); // orders | history | all
  const mode = String(req.query.mode || 'all');
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();

  try {
    await settleDueRounds();
    const conditions = [];
    if (scope === 'orders') {
      conditions.push(eq(bets.status, 'pending'));
    } else if (scope === 'history') {
      conditions.push(sql`${bets.status} IN ('won', 'lost', 'refunded')`);
    }
    if (mode !== 'all' && WINGO_MODES[mode as WinGoMode]) {
      conditions.push(eq(bets.mode, mode));
    }
    if (['pending', 'won', 'lost', 'refunded'].includes(status)) {
      conditions.push(eq(bets.status, status));
    }
    if (search) {
      conditions.push(
        or(
          ilike(bets.ticketId, `%${search}%`),
          ilike(bets.periodId, `%${search}%`),
          ilike(users.displayName, `%${search}%`),
          ilike(users.username, `%${search}%`),
          ilike(users.phone, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )!
      );
    }

    const rows = await db
      .select({
        bet: bets,
        userName: users.displayName,
        username: users.username,
        winningNumber: gameRounds.winningNumber,
      })
      .from(bets)
      .leftJoin(users, eq(bets.userId, users.id))
      .leftJoin(gameRounds, eq(bets.roundId, gameRounds.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(bets.createdAt))
      .limit(150);

    return res.json({
      items: rows.map((r) => ({
        ...r.bet,
        userName: r.userName,
        username: r.username,
        winningNumber: r.winningNumber,
      })),
    });
  } catch (error) {
    console.error('Admin bets list error:', error);
    return res.status(500).json({ error: 'Unable to load betting records.' });
  }
});

// Mount Modules 9-23
adminRouter.use('/', adminFinanceSystemRouter);
