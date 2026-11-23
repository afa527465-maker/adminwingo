import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  commissions,
  depositRequests,
  giftCodes,
  giftRedemptions,
  supportMessages,
  supportTickets,
  users,
  wallets,
} from '../../db/schema.ts';
import { createRateLimiter, generateRef } from '../crypto.ts';
import { applyWalletMutationTx, recordAuditLog } from '../ledger.ts';
import { formatMoney } from '../rules.ts';
import {
  requireAuth,
  requireVerifiedAccount,
  type AuthenticatedRequest,
} from '../auth.ts';

export const communityRouter = Router();

const giftLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, label: 'gift' });
const supportLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, label: 'support' });

export const SUPPORT_CATEGORIES = [
  'Deposit problem',
  'Withdrawal problem',
  'Account problem',
  'Bank account problem',
  'Game problem',
  'Promotion or activity issue',
  'Cryptocurrency payment issue',
  'Other problems',
] as const;

// ---------------------------------------------------------------------------
// AGENCY & REFERRAL SYSTEM
// ---------------------------------------------------------------------------
communityRouter.get('/agency/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  try {
    const now = new Date();
    const yesterdayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    const yesterdayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));

    const [totalCommRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${commissions.commissionAmount}), 0)::numeric(18,2)` })
      .from(commissions)
      .where(eq(commissions.agentUserId, userId));

    const [yesterdayCommRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${commissions.commissionAmount}), 0)::numeric(18,2)` })
      .from(commissions)
      .where(
        and(
          eq(commissions.agentUserId, userId),
          gte(commissions.createdAt, yesterdayStart),
          lte(commissions.createdAt, yesterdayEnd)
        )
      );

    // Direct (Tier 1) subordinates
    const directUsers = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        status: users.status,
      })
      .from(users)
      .where(eq(users.referredById, userId))
      .orderBy(desc(users.createdAt));

    const directIds = directUsers.map((u) => u.id);

    // Team (Tier 2) subordinates
    const teamUsers =
      directIds.length > 0
        ? await db
            .select({
              id: users.id,
              displayName: users.displayName,
              referredById: users.referredById,
              createdAt: users.createdAt,
              lastLoginAt: users.lastLoginAt,
            })
            .from(users)
            .where(inArray(users.referredById, directIds))
        : [];

    const teamIds = teamUsers.map((u) => u.id);

    async function summarizeDeposits(ids: number[]) {
      if (ids.length === 0) {
        return { depositCount: 0, depositAmount: '0.00', firstDepositors: 0 };
      }
      const [row] = await db
        .select({
          depositCount: sql<number>`count(*)::int`,
          depositAmount: sql<string>`COALESCE(SUM(${depositRequests.amount}), 0)::numeric(18,2)`,
          firstDepositors: sql<number>`count(DISTINCT ${depositRequests.userId})::int`,
        })
        .from(depositRequests)
        .where(and(inArray(depositRequests.userId, ids), eq(depositRequests.status, 'completed')));
      return {
        depositCount: row?.depositCount || 0,
        depositAmount: row?.depositAmount || '0.00',
        firstDepositors: row?.firstDepositors || 0,
      };
    }

    const directDepositStats = await summarizeDeposits(directIds);
    const teamDepositStats = await summarizeDeposits(teamIds);

    const activeCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeMembers = [...directUsers, ...teamUsers].filter(
      (u) => u.lastLoginAt && u.lastLoginAt >= activeCutoff
    ).length;

    const recentCommissions = await db
      .select({
        id: commissions.id,
        tier: commissions.tier,
        sourceType: commissions.sourceType,
        sourceRef: commissions.sourceRef,
        baseAmount: commissions.baseAmount,
        ratePercent: commissions.ratePercent,
        commissionAmount: commissions.commissionAmount,
        createdAt: commissions.createdAt,
        sourceDisplayName: users.displayName,
      })
      .from(commissions)
      .leftJoin(users, eq(commissions.sourceUserId, users.id))
      .where(eq(commissions.agentUserId, userId))
      .orderBy(desc(commissions.createdAt))
      .limit(40);

    return res.json({
      inviteCode: req.authUser!.inviteCode,
      yesterdayCommission: yesterdayCommRow?.total || '0.00',
      totalCommission: totalCommRow?.total || '0.00',
      activeMembers,
      totalRegisteredMembers: directUsers.length + teamUsers.length,
      direct: {
        registeredCount: directUsers.length,
        ...directDepositStats,
      },
      team: {
        registeredCount: teamUsers.length,
        ...teamDepositStats,
      },
      subordinates: directUsers.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        tier: 1,
        status: u.status,
        joinedAt: u.createdAt,
        lastActiveAt: u.lastLoginAt,
      })),
      commissionHistory: recentCommissions,
    });
  } catch (error) {
    console.error('Agency dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load agency report.' });
  }
});

// ---------------------------------------------------------------------------
// GIFT CODES & PROMOTIONS
// ---------------------------------------------------------------------------
communityRouter.get('/gifts/history', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rows = await db
      .select({
        id: giftRedemptions.id,
        rewardAmount: giftRedemptions.rewardAmount,
        txRef: giftRedemptions.txRef,
        redeemedAt: giftRedemptions.redeemedAt,
        code: giftCodes.code,
        title: giftCodes.title,
        rewardType: giftCodes.rewardType,
      })
      .from(giftRedemptions)
      .innerJoin(giftCodes, eq(giftRedemptions.giftCodeId, giftCodes.id))
      .where(eq(giftRedemptions.userId, req.authUser!.id))
      .orderBy(desc(giftRedemptions.redeemedAt))
      .limit(50);

    return res.json({ items: rows });
  } catch (error) {
    console.error('Gift history error:', error);
    return res.status(500).json({ error: 'Unable to load redemption history.' });
  }
});

communityRouter.post(
  '/gifts/redeem',
  requireAuth,
  requireVerifiedAccount,
  giftLimiter,
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      code: z.string().trim().min(3).max(40),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please enter a valid gift code.' });
    }

    const normalizedCode = parsed.data.code.toUpperCase();

    try {
      const result = await db.transaction(async (tx) => {
        const [gift] = await tx
          .select()
          .from(giftCodes)
          .where(eq(giftCodes.code, normalizedCode))
          .for('update')
          .limit(1);

        if (!gift) {
          throw new Error('GIFT_NOT_FOUND');
        }
        if (!gift.isActive) {
          throw new Error('GIFT_PAUSED');
        }
        const now = new Date();
        if (now < gift.startsAt) {
          throw new Error('GIFT_NOT_STARTED');
        }
        if (now > gift.expiresAt) {
          throw new Error('GIFT_EXPIRED');
        }
        if (gift.currentRedemptions >= gift.maxRedemptions) {
          throw new Error('GIFT_EXHAUSTED');
        }

        // Single redemption per user check
        const [alreadyRedeemed] = await tx
          .select({ id: giftRedemptions.id })
          .from(giftRedemptions)
          .where(and(eq(giftRedemptions.giftCodeId, gift.id), eq(giftRedemptions.userId, req.authUser!.id)))
          .limit(1);

        if (alreadyRedeemed) {
          throw new Error('GIFT_ALREADY_REDEEMED');
        }

        // Eligibility: minimum deposit check
        const minDep = parseFloat(gift.minDepositRequired);
        if (minDep > 0) {
          const [w] = await tx
            .select({ totalDeposited: wallets.totalDeposited })
            .from(wallets)
            .where(eq(wallets.userId, req.authUser!.id))
            .limit(1);
          if (!w || parseFloat(w.totalDeposited) < minDep) {
            throw new Error(`GIFT_MIN_DEPOSIT:${formatMoney(minDep)}`);
          }
        }

        const reward = parseFloat(gift.rewardAmount);
        const { transaction, wallet } = await applyWalletMutationTx(tx, {
          userId: req.authUser!.id,
          type: 'gift_bonus',
          amount: reward,
          idempotencyKey: `gift:${gift.id}:user:${req.authUser!.id}`,
          sourceType: 'gift_redemption',
          sourceId: gift.code,
          note: `Gift code redeemed: ${gift.code} (${gift.title})`,
        });

        const [redemption] = await tx
          .insert(giftRedemptions)
          .values({
            giftCodeId: gift.id,
            userId: req.authUser!.id,
            rewardAmount: formatMoney(reward),
            txRef: transaction.txRef,
          })
          .returning();

        await tx
          .update(giftCodes)
          .set({ currentRedemptions: gift.currentRedemptions + 1 })
          .where(eq(giftCodes.id, gift.id));

        return { gift, redemption, wallet };
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email || req.authUser!.phone,
        action: 'gift.redeemed',
        entityType: 'gift_code',
        entityId: normalizedCode,
        details: { amount: result.gift.rewardAmount },
        ipAddress: req.ip,
      });

      return res.json({
        message: `Gift code ${normalizedCode} redeemed! ${result.gift.rewardAmount} credited to your wallet.`,
        redemption: result.redemption,
        wallet: result.wallet,
      });
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'GIFT_NOT_FOUND') return res.status(404).json({ error: 'Gift code not found.' });
      if (msg === 'GIFT_PAUSED') return res.status(400).json({ error: 'This promotion is currently paused.' });
      if (msg === 'GIFT_NOT_STARTED') return res.status(400).json({ error: 'This promotion has not started yet.' });
      if (msg === 'GIFT_EXPIRED') return res.status(400).json({ error: 'This gift code has expired.' });
      if (msg === 'GIFT_EXHAUSTED') return res.status(400).json({ error: 'This gift code has reached its redemption limit.' });
      if (msg === 'GIFT_ALREADY_REDEEMED') return res.status(409).json({ error: 'You have already redeemed this gift code.' });
      if (msg.startsWith('GIFT_MIN_DEPOSIT:')) {
        return res.status(400).json({ error: `Minimum cumulative deposit of ${msg.split(':')[1]} required for this code.` });
      }
      console.error('Redeem gift error:', error);
      return res.status(500).json({ error: 'Unable to redeem gift code.' });
    }
  }
);

// ---------------------------------------------------------------------------
// CUSTOMER SERVICE HELP CENTER
// ---------------------------------------------------------------------------
function validateSafeImageDataUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) {
    throw new Error('Invalid image attachment format. Only PNG, JPEG, or WebP images are allowed.');
  }
  if (url.length > 2_500_000) {
    throw new Error('Image attachment is too large (max ~1.8MB).');
  }
  return url;
}

communityRouter.get('/support/tickets', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, req.authUser!.id))
      .orderBy(desc(supportTickets.updatedAt))
      .limit(50);

    return res.json({ categories: SUPPORT_CATEGORIES, items });
  } catch (error) {
    console.error('List support tickets error:', error);
    return res.status(500).json({ error: 'Unable to load support tickets.' });
  }
});

communityRouter.post(
  '/support/tickets',
  requireAuth,
  supportLimiter,
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      category: z.enum(SUPPORT_CATEGORIES),
      subject: z.string().trim().min(4).max(120),
      message: z.string().trim().min(6).max(2000),
      attachmentDataUrl: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid support ticket details.' });
    }

    let safeAttachment: string | null = null;
    try {
      safeAttachment = validateSafeImageDataUrl(parsed.data.attachmentDataUrl);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const ticketRef = generateRef('SUP');
      const created = await db.transaction(async (tx) => {
        const [ticket] = await tx
          .insert(supportTickets)
          .values({
            ticketRef,
            userId: req.authUser!.id,
            category: parsed.data.category,
            subject: parsed.data.subject,
            priority:
              parsed.data.category === 'Deposit problem' || parsed.data.category === 'Withdrawal problem'
                ? 'high'
                : 'normal',
            status: 'open',
          })
          .returning();

        const [firstMsg] = await tx
          .insert(supportMessages)
          .values({
            ticketId: ticket.id,
            senderUserId: req.authUser!.id,
            senderRole: 'player',
            message: parsed.data.message,
            attachmentDataUrl: safeAttachment,
          })
          .returning();

        return { ticket, messages: [firstMsg] };
      });

      return res.status(201).json(created);
    } catch (error) {
      console.error('Create ticket error:', error);
      return res.status(500).json({ error: 'Unable to submit support ticket.' });
    }
  }
);

communityRouter.get('/support/tickets/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ticket ID.' });

  try {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, req.authUser!.id)))
      .limit(1);

    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, ticket.id))
      .orderBy(supportMessages.createdAt);

    return res.json({ ticket, messages });
  } catch (error) {
    console.error('Ticket detail error:', error);
    return res.status(500).json({ error: 'Unable to load ticket conversation.' });
  }
});

communityRouter.post(
  '/support/tickets/:id/messages',
  requireAuth,
  supportLimiter,
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({
      message: z.string().trim().min(1).max(2000),
      attachmentDataUrl: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid message payload.' });
    }

    let safeAttachment: string | null = null;
    try {
      safeAttachment = validateSafeImageDataUrl(parsed.data.attachmentDataUrl);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, req.authUser!.id)))
        .limit(1);

      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

      const [msg] = await db
        .insert(supportMessages)
        .values({
          ticketId: ticket.id,
          senderUserId: req.authUser!.id,
          senderRole: 'player',
          message: parsed.data.message,
          attachmentDataUrl: safeAttachment,
        })
        .returning();

      await db
        .update(supportTickets)
        .set({ updatedAt: new Date(), status: ticket.status === 'closed' ? 'open' : ticket.status })
        .where(eq(supportTickets.id, ticket.id));

      return res.status(201).json({ message: msg });
    } catch (error) {
      console.error('Reply ticket error:', error);
      return res.status(500).json({ error: 'Unable to send reply.' });
    }
  }
);
