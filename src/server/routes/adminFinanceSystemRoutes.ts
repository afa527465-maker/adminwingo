import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  bankAccounts,
  bets,
  commissions,
  depositRequests,
  gameRounds,
  giftCodes,
  giftRedemptions,
  ledgerTransactions,
  platformSettings,
  sessions,
  supportMessages,
  supportTickets,
  users,
  wallets,
  withdrawalRequests,
} from '../../db/schema.ts';
import {
  applyWalletMutation,
  applyWalletMutationTx,
  ensureWallet,
  reconcileWalletLedger,
  recordAuditLog,
} from '../ledger.ts';
import {
  getPaymentChannels,
  getWithdrawalRailConfig,
  type PaymentChannelConfig,
  type WithdrawalRailConfig,
} from './walletRoutes.ts';
import { getVerificationProviderStatus } from './authRoutes.ts';
import { requireAdmin, type AuthenticatedRequest } from '../auth.ts';
import { verifyPassword } from '../crypto.ts';
import {
  listDepositChannels,
  mapDbChannelToDto,
  saveQrImageFromBase64,
  validateAndNormalizeChannelPayload,
} from '../depositChannels.ts';
import { depositChannels } from '../../db/schema.ts';

export const adminFinanceSystemRouter = Router();

// Helper to read/write JSON settings in platform_settings
async function getSettingJson<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row ? (row.valueJson as T) : fallback;
}

async function upsertSettingJson(key: string, valueJson: unknown, updatedByUserId: number) {
  await db
    .insert(platformSettings)
    .values({ key, valueJson, updatedByUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { valueJson, updatedByUserId, updatedAt: new Date() },
    });
}

// =========================================================================
// 9. WALLET MANAGEMENT & AUDITABLE ADJUSTMENT
// =========================================================================
adminFinanceSystemRouter.get(
  '/wallets',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (req, res) => {
    const search = String(req.query.search || '').trim();
    try {
      const conditions = [sql`${users.role} IN ('player', 'agent')`];
      if (search) {
        conditions.push(
          or(
            ilike(users.displayName, `%${search}%`),
            ilike(users.email, `%${search}%`),
            ilike(users.phone, `%${search}%`),
            ilike(users.username, `%${search}%`)
          )!
        );
      }

      const rows = await db
        .select({
          userId: users.id,
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          phone: users.phone,
          status: users.status,
          currency: wallets.currency,
          availableBalance: wallets.availableBalance,
          reservedBalance: wallets.reservedBalance,
          totalDeposited: wallets.totalDeposited,
          totalWithdrawn: wallets.totalWithdrawn,
          totalWagered: wallets.totalWagered,
          totalWon: wallets.totalWon,
          updatedAt: wallets.updatedAt,
        })
        .from(users)
        .leftJoin(wallets, eq(users.id, wallets.userId))
        .where(and(...conditions))
        .orderBy(desc(users.createdAt))
        .limit(100);

      return res.json({ items: rows });
    } catch (error) {
      console.error('Admin wallets list error:', error);
      return res.status(500).json({ error: 'Unable to load player wallets.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/wallets/:userId/adjust',
  requireAdmin(['super_admin', 'finance']),
  async (req: AuthenticatedRequest, res) => {
    const targetUserId = parseInt(req.params.userId, 10);
    const schema = z.object({
      direction: z.enum(['credit', 'debit']),
      amount: z.number().positive().max(1000000),
      reason: z.string().trim().min(4, 'Audit reason must be at least 4 characters.').max(240),
      idempotencyKey: z.string().trim().min(6).max(96),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(targetUserId) || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'Invalid user ID.' : parsed.error.issues[0]?.message,
      });
    }

    try {
      const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      await ensureWallet(target.id);
      const signedAmount =
        parsed.data.direction === 'credit' ? parsed.data.amount : -parsed.data.amount;

      const result = await applyWalletMutation({
        userId: target.id,
        type: 'admin_adjustment',
        amount: signedAmount,
        idempotencyKey: `adj:${target.id}:${parsed.data.idempotencyKey}`,
        sourceType: 'admin_adjustment',
        sourceId: `admin:${req.authUser!.id}`,
        note: `[Admin ${req.authUser!.username || req.authUser!.displayName}] ${parsed.data.reason}`,
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: `admin.wallet_${parsed.data.direction}`,
        entityType: 'wallet',
        entityId: String(target.id),
        details: {
          amount: signedAmount,
          reason: parsed.data.reason,
          txRef: result.transaction.txRef,
          balanceAfter: result.wallet.availableBalance,
        },
        ipAddress: req.ip,
      });

      return res.status(result.duplicate ? 200 : 201).json({
        message: 'Wallet adjustment recorded in immutable ledger.',
        wallet: result.wallet,
        transaction: result.transaction,
      });
    } catch (error: any) {
      if (error?.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'Insufficient available balance for debit adjustment.' });
      }
      console.error('Admin wallet adjust error:', error);
      return res.status(500).json({ error: 'Unable to apply wallet adjustment.' });
    }
  }
);

// =========================================================================
// 10. DEPOSIT MANAGEMENT
// =========================================================================
adminFinanceSystemRouter.get(
  '/finance/deposits',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (req, res) => {
    const status = String(req.query.status || 'all');
    try {
      const conditions = [];
      if (['pending', 'awaiting_verification', 'completed', 'rejected', 'expired', 'refunded'].includes(status)) {
        conditions.push(eq(depositRequests.status, status));
      }

      const rows = await db
        .select({
          deposit: depositRequests,
          userName: users.displayName,
          userEmail: users.email,
          userPhone: users.phone,
        })
        .from(depositRequests)
        .leftJoin(users, eq(depositRequests.userId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(depositRequests.createdAt))
        .limit(100);

      return res.json({
        items: rows.map((r) => ({
          ...r.deposit,
          userName: r.userName,
          userEmail: r.userEmail,
          userPhone: r.userPhone,
        })),
      });
    } catch (error) {
      console.error('Admin deposits error:', error);
      return res.status(500).json({ error: 'Unable to load deposit queue.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/finance/deposits/:id/review',
  requireAdmin(['super_admin', 'finance']),
  async (req: AuthenticatedRequest, res) => {
    const depositId = parseInt(req.params.id, 10);
    const schema = z.object({
      action: z.enum(['approve', 'reject', 'refund']),
      note: z.string().trim().max(240).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(depositId) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid deposit review request.' });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [dep] = await tx
          .select()
          .from(depositRequests)
          .where(eq(depositRequests.id, depositId))
          .for('update')
          .limit(1);

        if (!dep) throw new Error('NOT_FOUND');

        if (parsed.data.action === 'approve') {
          if (dep.status !== 'pending' && dep.status !== 'awaiting_verification') throw new Error('INVALID_STATE');
          const totalCredit = parseFloat(dep.amount) + parseFloat(dep.bonusAmount);

          await applyWalletMutationTx(tx, {
            userId: dep.userId,
            type: 'deposit',
            amount: totalCredit,
            idempotencyKey: `deposit-approve:${dep.orderRef}`,
            sourceType: 'deposit_request',
            sourceId: dep.orderRef,
            note: `Verified deposit ${dep.orderRef} (${dep.channelLabel})${dep.utrReference ? ` UTR:${dep.utrReference}` : ''}`,
            totalsDelta: { deposited: parseFloat(dep.amount) },
          });

          const [updated] = await tx
            .update(depositRequests)
            .set({
              status: 'completed',
              reviewedByUserId: req.authUser!.id,
              reviewNote: parsed.data.note || 'Payment verified and credited',
              completedAt: new Date(),
            })
            .where(eq(depositRequests.id, dep.id))
            .returning();

          return updated;
        }

        if (parsed.data.action === 'reject') {
          if (dep.status !== 'pending' && dep.status !== 'awaiting_verification') throw new Error('INVALID_STATE');
          const [updated] = await tx
            .update(depositRequests)
            .set({
              status: 'rejected',
              reviewedByUserId: req.authUser!.id,
              reviewNote: parsed.data.note || 'Payment could not be verified',
            })
            .where(eq(depositRequests.id, dep.id))
            .returning();
          return updated;
        }

        if (dep.status !== 'completed') throw new Error('INVALID_STATE');
        await applyWalletMutationTx(tx, {
          userId: dep.userId,
          type: 'deposit',
          amount: -(parseFloat(dep.amount) + parseFloat(dep.bonusAmount)),
          idempotencyKey: `deposit-refund:${dep.orderRef}`,
          sourceType: 'deposit_refund',
          sourceId: dep.orderRef,
          note: `Deposit refund/reversal ${dep.orderRef}`,
        });

        const [updated] = await tx
          .update(depositRequests)
          .set({
            status: 'refunded',
            reviewedByUserId: req.authUser!.id,
            reviewNote: parsed.data.note || 'Deposit refunded',
          })
          .where(eq(depositRequests.id, dep.id))
          .returning();
        return updated;
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: `admin.deposit_${parsed.data.action}`,
        entityType: 'deposit_request',
        entityId: result.orderRef,
        details: { note: parsed.data.note, amount: result.amount },
        ipAddress: req.ip,
      });

      return res.json({ deposit: result });
    } catch (error: any) {
      if (error?.message === 'NOT_FOUND') return res.status(404).json({ error: 'Deposit not found.' });
      if (error?.message === 'INVALID_STATE')
        return res.status(400).json({ error: 'Deposit is not in a valid state for this action.' });
      if (error?.message === 'INSUFFICIENT_BALANCE')
        return res.status(400).json({ error: 'User has insufficient balance to reverse this deposit.' });
      console.error('Deposit review error:', error);
      return res.status(500).json({ error: 'Deposit review failed.' });
    }
  }
);

// =========================================================================
// 11. WITHDRAWAL MANAGEMENT
// =========================================================================
adminFinanceSystemRouter.get(
  '/finance/withdrawals',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (req, res) => {
    const status = String(req.query.status || 'all');
    try {
      const conditions = [];
      if (['pending', 'approved', 'completed', 'rejected'].includes(status)) {
        conditions.push(eq(withdrawalRequests.status, status));
      }

      const rows = await db
        .select({
          withdrawal: withdrawalRequests,
          userName: users.displayName,
          userEmail: users.email,
          userPhone: users.phone,
          bankName: bankAccounts.bankName,
          recipientName: bankAccounts.recipientName,
          accountNumberMasked: bankAccounts.accountNumberMasked,
          routingCodeLabel: bankAccounts.routingCodeLabel,
          routingCodeValue: bankAccounts.routingCodeValue,
        })
        .from(withdrawalRequests)
        .leftJoin(users, eq(withdrawalRequests.userId, users.id))
        .leftJoin(bankAccounts, eq(withdrawalRequests.bankAccountId, bankAccounts.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(withdrawalRequests.createdAt))
        .limit(100);

      return res.json({
        items: rows.map((r) => ({
          ...r.withdrawal,
          userName: r.userName,
          userEmail: r.userEmail,
          userPhone: r.userPhone,
          bankName: r.bankName,
          recipientName: r.recipientName,
          accountNumberMasked: r.accountNumberMasked,
          routingCodeLabel: r.routingCodeLabel,
          routingCodeValue: r.routingCodeValue,
        })),
      });
    } catch (error) {
      console.error('Admin withdrawals error:', error);
      return res.status(500).json({ error: 'Unable to load withdrawal queue.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/finance/withdrawals/:id/review',
  requireAdmin(['super_admin', 'finance']),
  async (req: AuthenticatedRequest, res) => {
    const withdrawalId = parseInt(req.params.id, 10);
    const schema = z.object({
      action: z.enum(['approve', 'complete', 'reject']),
      payoutReference: z.string().trim().max(80).optional(),
      note: z.string().trim().max(240).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(withdrawalId) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid withdrawal review request.' });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [wd] = await tx
          .select()
          .from(withdrawalRequests)
          .where(eq(withdrawalRequests.id, withdrawalId))
          .for('update')
          .limit(1);

        if (!wd) throw new Error('NOT_FOUND');

        if (parsed.data.action === 'approve') {
          if (wd.status !== 'pending') throw new Error('INVALID_STATE');
          const [updated] = await tx
            .update(withdrawalRequests)
            .set({
              status: 'approved',
              reviewedByUserId: req.authUser!.id,
              reviewNote: parsed.data.note || 'Approved for payout disbursement',
            })
            .where(eq(withdrawalRequests.id, wd.id))
            .returning();
          return updated;
        }

        if (parsed.data.action === 'complete') {
          if (!['pending', 'approved'].includes(wd.status)) throw new Error('INVALID_STATE');
          const [updated] = await tx
            .update(withdrawalRequests)
            .set({
              status: 'completed',
              reviewedByUserId: req.authUser!.id,
              payoutReference: parsed.data.payoutReference || `PAYOUT-${Date.now()}`,
              reviewNote: parsed.data.note || 'Payout confirmed',
              completedAt: new Date(),
            })
            .where(eq(withdrawalRequests.id, wd.id))
            .returning();
          return updated;
        }

        if (!['pending', 'approved'].includes(wd.status)) throw new Error('INVALID_STATE');

        await applyWalletMutationTx(tx, {
          userId: wd.userId,
          type: 'withdrawal_refund',
          amount: parseFloat(wd.amount),
          idempotencyKey: `wd-refund:${wd.orderRef}`,
          sourceType: 'withdrawal_refund',
          sourceId: wd.orderRef,
          note: `Withdrawal rejected and refunded (${wd.orderRef})`,
          totalsDelta: { withdrawn: -parseFloat(wd.amount) },
        });

        const [updated] = await tx
          .update(withdrawalRequests)
          .set({
            status: 'rejected',
            reviewedByUserId: req.authUser!.id,
            reviewNote: parsed.data.note || 'Withdrawal rejected; balance returned to wallet',
          })
          .where(eq(withdrawalRequests.id, wd.id))
          .returning();
        return updated;
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: `admin.withdrawal_${parsed.data.action}`,
        entityType: 'withdrawal_request',
        entityId: result.orderRef,
        details: { payoutReference: parsed.data.payoutReference, note: parsed.data.note },
        ipAddress: req.ip,
      });

      return res.json({ withdrawal: result });
    } catch (error: any) {
      if (error?.message === 'NOT_FOUND') return res.status(404).json({ error: 'Withdrawal not found.' });
      if (error?.message === 'INVALID_STATE')
        return res.status(400).json({ error: 'Withdrawal is not in a valid state for this action.' });
      console.error('Withdrawal review error:', error);
      return res.status(500).json({ error: 'Withdrawal review failed.' });
    }
  }
);

// =========================================================================
// 12. FINANCIAL TRANSACTIONS & RECONCILIATION
// =========================================================================
adminFinanceSystemRouter.get(
  '/finance/ledger',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (req, res) => {
    const type = String(req.query.type || 'all');
    const search = String(req.query.search || '').trim();
    try {
      const conditions = [];
      if (type !== 'all') {
        conditions.push(eq(ledgerTransactions.type, type));
      }
      if (search) {
        conditions.push(
          or(
            ilike(ledgerTransactions.txRef, `%${search}%`),
            ilike(ledgerTransactions.sourceId, `%${search}%`),
            ilike(users.displayName, `%${search}%`),
            ilike(users.email, `%${search}%`),
            ilike(users.phone, `%${search}%`)
          )!
        );
      }

      const rows = await db
        .select({
          tx: ledgerTransactions,
          userName: users.displayName,
          userEmail: users.email,
          userPhone: users.phone,
        })
        .from(ledgerTransactions)
        .leftJoin(users, eq(ledgerTransactions.userId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(ledgerTransactions.createdAt))
        .limit(150);

      return res.json({
        items: rows.map((r) => ({
          ...r.tx,
          userName: r.userName,
          userEmail: r.userEmail,
          userPhone: r.userPhone,
        })),
      });
    } catch (error) {
      console.error('Admin ledger error:', error);
      return res.status(500).json({ error: 'Unable to load financial transactions.' });
    }
  }
);

adminFinanceSystemRouter.get(
  '/finance/reconcile',
  requireAdmin(['super_admin', 'finance']),
  async (_req, res) => {
    try {
      const rows = await reconcileWalletLedger();
      const discrepancies = rows.filter((r: any) => Math.abs(parseFloat(r.discrepancy || '0')) > 0.001);
      return res.json({
        checkedWallets: rows.length,
        discrepancyCount: discrepancies.length,
        rows,
      });
    } catch (error) {
      console.error('Reconcile error:', error);
      return res.status(500).json({ error: 'Ledger reconciliation failed.' });
    }
  }
);

// =========================================================================
// 13, 14, 15. AGENT, REFERRAL & COMMISSION MANAGEMENT
// =========================================================================
adminFinanceSystemRouter.get(
  '/agency/overview',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const topAgents = await db.execute(sql`
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.email,
          u.phone,
          u.role,
          u.invite_code,
          (SELECT COUNT(*)::int FROM users r WHERE r.referred_by_id = u.id) AS direct_referrals,
          COALESCE((SELECT SUM(c.commission_amount)::numeric(18,2) FROM commissions c WHERE c.agent_user_id = u.id), 0) AS total_commission
        FROM users u
        WHERE u.role = 'agent' OR EXISTS (SELECT 1 FROM users r WHERE r.referred_by_id = u.id)
        ORDER BY total_commission DESC, direct_referrals DESC
        LIMIT 50
      `);

      return res.json({ agents: topAgents.rows });
    } catch (error) {
      console.error('Admin agency overview error:', error);
      return res.status(500).json({ error: 'Unable to load agent accounts.' });
    }
  }
);

adminFinanceSystemRouter.patch(
  '/agents/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({ role: z.enum(['player', 'agent']) });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid agent update request.' });
    }
    try {
      const [updated] = await db
        .update(users)
        .set({ role: parsed.data.role })
        .where(eq(users.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'User not found.' });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.agent_role_updated',
        entityType: 'user',
        entityId: String(id),
        details: { role: parsed.data.role },
        ipAddress: req.ip,
      });

      return res.json({ user: updated });
    } catch (error) {
      console.error('Update agent role error:', error);
      return res.status(500).json({ error: 'Unable to update agent role.' });
    }
  }
);

adminFinanceSystemRouter.get(
  '/referrals',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT
          child.id AS referred_user_id,
          child.display_name AS referred_name,
          child.email AS referred_email,
          child.phone AS referred_phone,
          child.status AS referred_status,
          child.created_at AS joined_at,
          parent.id AS referrer_user_id,
          parent.display_name AS referrer_name,
          parent.invite_code AS referrer_code
        FROM users child
        INNER JOIN users parent ON child.referred_by_id = parent.id
        ORDER BY child.created_at DESC
        LIMIT 100
      `);
      return res.json({ items: rows.rows });
    } catch (error) {
      console.error('Admin referrals error:', error);
      return res.status(500).json({ error: 'Unable to load referrals.' });
    }
  }
);

adminFinanceSystemRouter.get(
  '/commissions',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const rows = await db
        .select({
          commission: commissions,
          agentName: users.displayName,
        })
        .from(commissions)
        .leftJoin(users, eq(commissions.agentUserId, users.id))
        .orderBy(desc(commissions.createdAt))
        .limit(100);

      return res.json({
        items: rows.map((r) => ({ ...r.commission, agentName: r.agentName })),
      });
    } catch (error) {
      console.error('Admin commissions error:', error);
      return res.status(500).json({ error: 'Unable to load commissions.' });
    }
  }
);

// =========================================================================
// 16 & 17. GIFT CODES & PROMOTIONS CAMPAIGNS
// =========================================================================
adminFinanceSystemRouter.get(
  '/promotions',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const [codes, redemptions] = await Promise.all([
        db.select().from(giftCodes).orderBy(desc(giftCodes.createdAt)).limit(50),
        db
          .select({
            redemption: giftRedemptions,
            userName: users.displayName,
            code: giftCodes.code,
          })
          .from(giftRedemptions)
          .leftJoin(users, eq(giftRedemptions.userId, users.id))
          .leftJoin(giftCodes, eq(giftRedemptions.giftCodeId, giftCodes.id))
          .orderBy(desc(giftRedemptions.redeemedAt))
          .limit(50),
      ]);

      return res.json({
        giftCodes: codes,
        redemptions: redemptions.map((r) => ({
          ...r.redemption,
          userName: r.userName,
          code: r.code,
        })),
      });
    } catch (error) {
      console.error('Admin gift codes error:', error);
      return res.status(500).json({ error: 'Unable to load gift codes.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/promotions',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      code: z.string().trim().min(4).max(32),
      title: z.string().trim().min(3).max(80),
      rewardAmount: z.number().positive().max(10000),
      maxRedemptions: z.number().int().min(1).max(100000),
      minDepositRequired: z.number().min(0).default(0),
      expiresInDays: z.number().int().min(1).max(365).default(30),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid gift code data.' });
    }

    try {
      const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);
      const [created] = await db
        .insert(giftCodes)
        .values({
          code: parsed.data.code.toUpperCase(),
          title: parsed.data.title,
          rewardAmount: parsed.data.rewardAmount.toFixed(2),
          maxRedemptions: parsed.data.maxRedemptions,
          minDepositRequired: parsed.data.minDepositRequired.toFixed(2),
          isActive: true,
          expiresAt,
          createdByUserId: req.authUser!.id,
        })
        .returning();

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.gift_code_created',
        entityType: 'gift_code',
        entityId: created.code,
        details: { rewardAmount: created.rewardAmount, maxRedemptions: created.maxRedemptions },
        ipAddress: req.ip,
      });

      return res.status(201).json({ giftCode: created });
    } catch (error: any) {
      if (String(error?.message || '').includes('unique')) {
        return res.status(409).json({ error: 'A gift code with this code already exists.' });
      }
      console.error('Create gift code error:', error);
      return res.status(500).json({ error: 'Unable to create gift code.' });
    }
  }
);

adminFinanceSystemRouter.patch(
  '/promotions/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({ isActive: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid gift code update.' });
    }
    try {
      const [updated] = await db
        .update(giftCodes)
        .set({ isActive: parsed.data.isActive })
        .where(eq(giftCodes.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Gift code not found.' });
      return res.json({ giftCode: updated });
    } catch (error) {
      console.error('Toggle gift code error:', error);
      return res.status(500).json({ error: 'Unable to update gift code.' });
    }
  }
);

interface CampaignItem {
  id: string;
  title: string;
  description: string;
  bonusType: 'deposit_match' | 'cashback' | 'referral_boost' | 'event';
  bonusPercent: number;
  minQualifyingAmount: number;
  active: boolean;
  createdAt: string;
}

adminFinanceSystemRouter.get(
  '/campaigns',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    const items = await getSettingJson<CampaignItem[]>('promotions_campaigns', []);
    return res.json({ items });
  }
);

adminFinanceSystemRouter.post(
  '/campaigns',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().min(5).max(500),
      bonusType: z.enum(['deposit_match', 'cashback', 'referral_boost', 'event']).default('deposit_match'),
      bonusPercent: z.number().min(0).max(100).default(0),
      minQualifyingAmount: z.number().min(0).default(0),
      active: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid campaign data.' });
    }
    const current = await getSettingJson<CampaignItem[]>('promotions_campaigns', []);
    const item: CampaignItem = {
      id: `CMP-${Date.now().toString(36).toUpperCase()}`,
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...current];
    await upsertSettingJson('promotions_campaigns', next, req.authUser!.id);

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.username || req.authUser!.email,
      action: 'admin.campaign_created',
      entityType: 'campaign',
      entityId: item.id,
      details: { title: item.title },
      ipAddress: req.ip,
    });
    return res.status(201).json({ campaign: item, items: next });
  }
);

adminFinanceSystemRouter.patch(
  '/campaigns/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ active: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign update.' });

    const current = await getSettingJson<CampaignItem[]>('promotions_campaigns', []);
    const next = current.map((c) => (c.id === req.params.id ? { ...c, active: parsed.data.active } : c));
    await upsertSettingJson('promotions_campaigns', next, req.authUser!.id);
    return res.json({ items: next });
  }
);

adminFinanceSystemRouter.delete(
  '/campaigns/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const current = await getSettingJson<CampaignItem[]>('promotions_campaigns', []);
    const next = current.filter((c) => c.id !== req.params.id);
    await upsertSettingJson('promotions_campaigns', next, req.authUser!.id);
    return res.json({ items: next });
  }
);

// =========================================================================
// 18. CUSTOMER SERVICE (SUPPORT TICKETS)
// =========================================================================
adminFinanceSystemRouter.get(
  '/support/tickets',
  requireAdmin(['super_admin', 'admin', 'support', 'finance']),
  async (req, res) => {
    const status = String(req.query.status || 'all');
    try {
      const conditions = [];
      if (['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
        conditions.push(eq(supportTickets.status, status));
      }

      const rows = await db
        .select({
          ticket: supportTickets,
          userName: users.displayName,
          userEmail: users.email,
          userPhone: users.phone,
        })
        .from(supportTickets)
        .leftJoin(users, eq(supportTickets.userId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(supportTickets.updatedAt))
        .limit(100);

      return res.json({
        items: rows.map((r) => ({
          ...r.ticket,
          userName: r.userName,
          userEmail: r.userEmail,
          userPhone: r.userPhone,
        })),
      });
    } catch (error) {
      console.error('Admin support list error:', error);
      return res.status(500).json({ error: 'Unable to load support tickets.' });
    }
  }
);

adminFinanceSystemRouter.get(
  '/support/tickets/:id',
  requireAdmin(['super_admin', 'admin', 'support', 'finance']),
  async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket ID.' });

    try {
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

      const messages = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, ticket.id))
        .orderBy(supportMessages.createdAt);

      return res.json({ ticket, messages });
    } catch (error) {
      console.error('Admin ticket detail error:', error);
      return res.status(500).json({ error: 'Unable to load ticket conversation.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/support/tickets/:id/reply',
  requireAdmin(['super_admin', 'admin', 'support', 'finance']),
  async (req: AuthenticatedRequest, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const schema = z.object({
      message: z.string().trim().min(1).max(2000),
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
      internalNotes: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(ticketId) || !parsed.success) {
      return res.status(400).json({ error: 'Valid reply message required.' });
    }

    try {
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

      const [msg] = await db
        .insert(supportMessages)
        .values({
          ticketId: ticket.id,
          senderUserId: req.authUser!.id,
          senderRole: 'admin',
          message: parsed.data.message,
        })
        .returning();

      const [updatedTicket] = await db
        .update(supportTickets)
        .set({
          status: parsed.data.status || 'in_progress',
          assignedAdminId: req.authUser!.id,
          ...(parsed.data.internalNotes !== undefined
            ? { internalNotes: parsed.data.internalNotes }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, ticket.id))
        .returning();

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.ticket_replied',
        entityType: 'support_ticket',
        entityId: ticket.ticketRef,
        details: { status: updatedTicket.status },
        ipAddress: req.ip,
      });

      return res.status(201).json({ ticket: updatedTicket, message: msg });
    } catch (error) {
      console.error('Admin ticket reply error:', error);
      return res.status(500).json({ error: 'Unable to send support reply.' });
    }
  }
);

adminFinanceSystemRouter.patch(
  '/support/tickets/:id',
  requireAdmin(['super_admin', 'admin', 'support', 'finance']),
  async (req: AuthenticatedRequest, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const schema = z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      internalNotes: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(ticketId) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid ticket update payload.' });
    }
    try {
      const [updated] = await db
        .update(supportTickets)
        .set({
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
          ...(parsed.data.internalNotes !== undefined
            ? { internalNotes: parsed.data.internalNotes }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, ticketId))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Ticket not found.' });
      return res.json({ ticket: updated });
    } catch (error) {
      console.error('Update ticket error:', error);
      return res.status(500).json({ error: 'Unable to update ticket.' });
    }
  }
);

// =========================================================================
// 19. ANNOUNCEMENTS (SYNCED LIVE TO GAME PAGE)
// =========================================================================
export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
}

adminFinanceSystemRouter.get(
  '/announcements',
  requireAdmin(['super_admin', 'admin', 'support']),
  async (_req, res) => {
    const items = await getSettingJson<AnnouncementRecord[]>('announcements_list', []);
    return res.json({ items });
  }
);

adminFinanceSystemRouter.post(
  '/announcements',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      title: z.string().trim().min(2).max(120),
      content: z.string().trim().min(4).max(600),
      enabled: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid announcement.' });
    }
    const current = await getSettingJson<AnnouncementRecord[]>('announcements_list', []);
    const record: AnnouncementRecord = {
      id: `ANN-${Date.now().toString(36).toUpperCase()}`,
      title: parsed.data.title,
      content: parsed.data.content,
      enabled: parsed.data.enabled,
      createdBy: req.authUser!.username || req.authUser!.displayName,
      createdAt: new Date().toISOString(),
    };
    const next = [record, ...current];
    await upsertSettingJson('announcements_list', next, req.authUser!.id);
    if (record.enabled) {
      await upsertSettingJson('announcement', { text: record.content, enabled: true }, req.authUser!.id);
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.username || req.authUser!.email,
      action: 'admin.announcement_created',
      entityType: 'announcement',
      entityId: record.id,
      details: { title: record.title, enabled: record.enabled },
      ipAddress: req.ip,
    });

    return res.status(201).json({ announcement: record, items: next });
  }
);

adminFinanceSystemRouter.patch(
  '/announcements/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      enabled: z.boolean().optional(),
      title: z.string().trim().min(2).max(120).optional(),
      content: z.string().trim().min(4).max(600).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid announcement update.' });

    const current = await getSettingJson<AnnouncementRecord[]>('announcements_list', []);
    const next = current.map((a) => (a.id === req.params.id ? { ...a, ...parsed.data } : a));
    await upsertSettingJson('announcements_list', next, req.authUser!.id);

    const activeAnn = next.find((a) => a.enabled);
    await upsertSettingJson(
      'announcement',
      {
        text:
          activeAnn?.content ||
          'WinGo uses server-controlled rounds, cryptographic seed commitments, and an auditable PostgreSQL ledger.',
        enabled: Boolean(activeAnn),
      },
      req.authUser!.id
    );

    return res.json({ items: next });
  }
);

adminFinanceSystemRouter.delete(
  '/announcements/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const current = await getSettingJson<AnnouncementRecord[]>('announcements_list', []);
    const next = current.filter((a) => a.id !== req.params.id);
    await upsertSettingJson('announcements_list', next, req.authUser!.id);
    const activeAnn = next.find((a) => a.enabled);
    await upsertSettingJson(
      'announcement',
      {
        text:
          activeAnn?.content ||
          'WinGo uses server-controlled rounds, cryptographic seed commitments, and an auditable PostgreSQL ledger.',
        enabled: Boolean(activeAnn),
      },
      req.authUser!.id
    );
    return res.json({ items: next });
  }
);

// =========================================================================
// 20. REPORTS (REAL SQL FINANCIAL, BETTING & USER ANALYTICS)
// =========================================================================
adminFinanceSystemRouter.get(
  '/reports',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (req, res) => {
    const fromStr = String(req.query.from || '').trim();
    const toStr = String(req.query.to || '').trim();
    const fromDate = fromStr && !Number.isNaN(Date.parse(fromStr)) ? new Date(fromStr) : new Date(Date.now() - 30 * 86400000);
    const toDate = toStr && !Number.isNaN(Date.parse(toStr)) ? new Date(toStr) : new Date();
    toDate.setHours(23, 59, 59, 999);

    try {
      const [userSummary, betSummary, depSummary, wdSummary, byMode] = await Promise.all([
        db
          .select({ newPlayers: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              sql`${users.role} IN ('player', 'agent')`,
              gte(users.createdAt, fromDate),
              lte(users.createdAt, toDate)
            )
          ),
        db
          .select({
            totalBets: sql<number>`count(*)::int`,
            totalStake: sql<string>`COALESCE(SUM(${bets.totalStake}), 0)::numeric(18,2)::text`,
            totalPayout: sql<string>`COALESCE(SUM(${bets.actualPayout}), 0)::numeric(18,2)::text`,
            totalFees: sql<string>`COALESCE(SUM(${bets.feeAmount}), 0)::numeric(18,2)::text`,
          })
          .from(bets)
          .where(and(gte(bets.createdAt, fromDate), lte(bets.createdAt, toDate))),
        db
          .select({
            completedDeposits: sql<string>`COALESCE(SUM(${depositRequests.amount}), 0)::numeric(18,2)::text`,
            depositCount: sql<number>`count(*)::int`,
          })
          .from(depositRequests)
          .where(
            and(
              eq(depositRequests.status, 'completed'),
              gte(depositRequests.createdAt, fromDate),
              lte(depositRequests.createdAt, toDate)
            )
          ),
        db
          .select({
            completedWithdrawals: sql<string>`COALESCE(SUM(${withdrawalRequests.amount}), 0)::numeric(18,2)::text`,
            withdrawalCount: sql<number>`count(*)::int`,
          })
          .from(withdrawalRequests)
          .where(
            and(
              eq(withdrawalRequests.status, 'completed'),
              gte(withdrawalRequests.createdAt, fromDate),
              lte(withdrawalRequests.createdAt, toDate)
            )
          ),
        db
          .select({
            mode: bets.mode,
            betCount: sql<number>`count(*)::int`,
            totalStake: sql<string>`COALESCE(SUM(${bets.totalStake}), 0)::numeric(18,2)::text`,
            totalPayout: sql<string>`COALESCE(SUM(${bets.actualPayout}), 0)::numeric(18,2)::text`,
          })
          .from(bets)
          .where(and(gte(bets.createdAt, fromDate), lte(bets.createdAt, toDate)))
          .groupBy(bets.mode),
      ]);

      const stake = parseFloat(betSummary[0]?.totalStake || '0');
      const payout = parseFloat(betSummary[0]?.totalPayout || '0');
      const ggr = (stake - payout).toFixed(2);

      const settledRounds = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(gameRounds)
        .where(
          and(
            eq(gameRounds.status, 'settled'),
            gte(gameRounds.endsAt, fromDate),
            lte(gameRounds.endsAt, toDate)
          )
        );

      return res.json({
        range: { from: fromDate.toISOString(), to: toDate.toISOString() },
        summary: {
          newPlayers: userSummary[0]?.newPlayers || 0,
          settledRounds: settledRounds[0]?.count || 0,
          totalBets: betSummary[0]?.totalBets || 0,
          totalStake: betSummary[0]?.totalStake || '0.00',
          totalPayout: betSummary[0]?.totalPayout || '0.00',
          totalFees: betSummary[0]?.totalFees || '0.00',
          grossGamingRevenue: ggr,
          completedDeposits: depSummary[0]?.completedDeposits || '0.00',
          depositCount: depSummary[0]?.depositCount || 0,
          completedWithdrawals: wdSummary[0]?.completedWithdrawals || '0.00',
          withdrawalCount: wdSummary[0]?.withdrawalCount || 0,
        },
        byMode,
      });
    } catch (error) {
      console.error('Admin reports error:', error);
      return res.status(500).json({ error: 'Unable to generate reports.' });
    }
  }
);

// =========================================================================
// 21. PLATFORM SETTINGS
// =========================================================================
adminFinanceSystemRouter.get(
  '/system/settings',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const [channels, withdrawalRail, maintenance, announcement, registrationPolicy] = await Promise.all([
        getPaymentChannels(),
        getWithdrawalRailConfig(),
        getSettingJson<{ enabled: boolean; message: string }>('maintenance_mode', {
          enabled: false,
          message: '',
        }),
        getSettingJson<{ text: string; enabled: boolean }>('announcement', {
          text: 'WinGo uses server-controlled rounds, cryptographic seed commitments, and an auditable PostgreSQL ledger.',
          enabled: true,
        }),
        getSettingJson<{ mode: 'manual_admin_approval' | 'verified_sms_registration' }>('registration_policy', {
          mode: 'manual_admin_approval',
        }),
      ]);

      return res.json({
        mode: process.env.WINGO_MODE || 'development',
        currency: process.env.WINGO_CURRENCY || 'USD',
        providers: getVerificationProviderStatus(),
        announcement,
        maintenance,
        paymentChannels: channels,
        withdrawalRail,
        registrationPolicy,
      });
    } catch (error) {
      console.error('Admin settings load error:', error);
      return res.status(500).json({ error: 'Unable to load platform settings.' });
    }
  }
);

adminFinanceSystemRouter.patch(
  '/system/settings',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      announcementText: z.string().trim().min(4).max(500).optional(),
      announcementEnabled: z.boolean().optional(),
      maintenance: z
        .object({
          enabled: z.boolean(),
          message: z.string().trim().max(300).default(''),
        })
        .optional(),
      paymentChannels: z.array(z.any()).optional(),
      withdrawalRail: z
        .object({
          configured: z.boolean(),
          enabled: z.boolean(),
          minAmount: z.number().positive(),
          maxAmount: z.number().positive(),
          providerLabel: z.string().trim().min(2).max(80),
        })
        .optional(),
      registrationPolicy: z
        .object({
          mode: z.enum(['manual_admin_approval', 'verified_sms_registration']),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings payload.' });
    }

    try {
      if (parsed.data.announcementText !== undefined) {
        await upsertSettingJson(
          'announcement',
          { text: parsed.data.announcementText, enabled: parsed.data.announcementEnabled ?? true },
          req.authUser!.id
        );
      }

      if (parsed.data.maintenance !== undefined) {
        await upsertSettingJson('maintenance_mode', parsed.data.maintenance, req.authUser!.id);
      }

      if (parsed.data.paymentChannels !== undefined) {
        const sanitized: PaymentChannelConfig[] = parsed.data.paymentChannels.map((c: any) => ({
          code: String(c.code || 'custom').slice(0, 40),
          label: String(c.label || 'Channel').slice(0, 80),
          subtitle: String(c.subtitle || (c.configured ? 'Configured' : 'Not configured')).slice(0, 80),
          minAmount: Math.max(1, Number(c.minAmount || 10)),
          maxAmount: Math.max(10, Number(c.maxAmount || 50000)),
          bonusRate: Math.max(0, Math.min(50, Number(c.bonusRate || 0))),
          presets: Array.isArray(c.presets) ? c.presets.map(Number).filter((n: number) => n > 0) : [100, 500, 1000],
          configured: Boolean(c.configured) && Boolean(String(c.qrPayloadTemplate || '').trim()),
          enabled: Boolean(c.enabled) && Boolean(c.configured) && Boolean(String(c.qrPayloadTemplate || '').trim()),
          requiresUtr: c.requiresUtr !== false,
          qrPayloadTemplate: String(c.qrPayloadTemplate || '').trim().slice(0, 400),
          instructions: Array.isArray(c.instructions) ? c.instructions.map(String) : [],
        }));
        await upsertSettingJson('payment_channels', sanitized, req.authUser!.id);
      }

      if (parsed.data.withdrawalRail !== undefined) {
        const rail: WithdrawalRailConfig = {
          configured: parsed.data.withdrawalRail.configured,
          enabled: parsed.data.withdrawalRail.enabled && parsed.data.withdrawalRail.configured,
          minAmount: parsed.data.withdrawalRail.minAmount,
          maxAmount: parsed.data.withdrawalRail.maxAmount,
          providerLabel: parsed.data.withdrawalRail.providerLabel,
        };
        await upsertSettingJson('withdrawal_rail', rail, req.authUser!.id);
      }

      if (parsed.data.registrationPolicy !== undefined) {
        if (parsed.data.registrationPolicy.mode === 'verified_sms_registration') {
          const providers = getVerificationProviderStatus();
          if (!providers.smsConfigured) {
            return res.status(400).json({
              error: 'Cannot enable Verified SMS Registration because no SMS provider is configured.',
            });
          }
        }
        await upsertSettingJson('registration_policy', parsed.data.registrationPolicy, req.authUser!.id);
      }

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.settings_updated',
        entityType: 'platform_settings',
        entityId: 'global',
        details: {
          updatedAnnouncement: parsed.data.announcementText !== undefined,
          updatedMaintenance: parsed.data.maintenance !== undefined,
          updatedPaymentChannels: parsed.data.paymentChannels !== undefined,
          updatedWithdrawalRail: parsed.data.withdrawalRail !== undefined,
        },
        ipAddress: req.ip,
      });

      return res.json({ message: 'Platform settings saved successfully.' });
    } catch (error) {
      console.error('Admin settings update error:', error);
      return res.status(500).json({ error: 'Unable to update platform settings.' });
    }
  }
);

// =========================================================================
// 22. SECURITY SETTINGS & ACTIVE SESSION MANAGEMENT
// =========================================================================
interface SecurityPolicy {
  sessionTimeoutHours: number;
  adminMinPasswordLength: number;
  playerMinPasswordLength: number;
  maxLoginAttemptsPer15Min: number;
  requireEmailOrPhoneVerification: boolean;
  enforceAdminTwoFactor: boolean;
}

const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  sessionTimeoutHours: 24,
  adminMinPasswordLength: 10,
  playerMinPasswordLength: 8,
  maxLoginAttemptsPer15Min: 30,
  requireEmailOrPhoneVerification: true,
  enforceAdminTwoFactor: false,
};

adminFinanceSystemRouter.get(
  '/security/settings',
  requireAdmin(['super_admin', 'admin']),
  async (_req, res) => {
    const policy = await getSettingJson<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
    return res.json({ policy });
  }
);

adminFinanceSystemRouter.patch(
  '/security/settings',
  requireAdmin(['super_admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      sessionTimeoutHours: z.number().int().min(1).max(720),
      adminMinPasswordLength: z.number().int().min(10).max(64),
      playerMinPasswordLength: z.number().int().min(8).max(64),
      maxLoginAttemptsPer15Min: z.number().int().min(5).max(200),
      requireEmailOrPhoneVerification: z.boolean(),
      enforceAdminTwoFactor: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid security policy.' });
    }

    await upsertSettingJson('security_policy', parsed.data, req.authUser!.id);
    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.username || req.authUser!.email,
      action: 'admin.security_policy_updated',
      entityType: 'security_policy',
      entityId: 'global',
      details: parsed.data,
      ipAddress: req.ip,
    });
    return res.json({ policy: parsed.data, message: 'Security settings updated.' });
  }
);

adminFinanceSystemRouter.get(
  '/security/sessions',
  requireAdmin(['super_admin', 'admin']),
  async (_req, res) => {
    try {
      const rows = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
          expiresAt: sessions.expiresAt,
          createdAt: sessions.createdAt,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(gte(sessions.expiresAt, new Date()))
        .orderBy(desc(sessions.createdAt))
        .limit(100);

      return res.json({ items: rows });
    } catch (error) {
      console.error('Admin sessions list error:', error);
      return res.status(500).json({ error: 'Unable to load active sessions.' });
    }
  }
);

adminFinanceSystemRouter.delete(
  '/security/sessions/:id',
  requireAdmin(['super_admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid session ID.' });
    try {
      await db.delete(sessions).where(eq(sessions.id, id));
      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'admin.session_revoked',
        entityType: 'session',
        entityId: String(id),
        ipAddress: req.ip,
      });
      return res.json({ message: 'Session terminated.' });
    } catch (error) {
      console.error('Admin revoke session error:', error);
      return res.status(500).json({ error: 'Unable to terminate session.' });
    }
  }
);

// =========================================================================
// 23. AUDIT LOGS
// =========================================================================
adminFinanceSystemRouter.get(
  '/system/audit-logs',
  requireAdmin(['super_admin', 'admin', 'finance', 'support']),
  async (req, res) => {
    const search = String(req.query.search || '').trim();
    try {
      const whereClause = search
        ? or(
            ilike(auditLogs.action, `%${search}%`),
            ilike(auditLogs.actorEmail, `%${search}%`),
            ilike(auditLogs.entityType, `%${search}%`),
            ilike(auditLogs.entityId, `%${search}%`)
          )
        : undefined;

      const items = await db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(150);

      return res.json({ items });
    } catch (error) {
      console.error('Admin audit logs error:', error);
      return res.status(500).json({ error: 'Unable to load audit logs.' });
    }
  }
);

// =========================================================================
// 24. ADMIN DEPOSIT PAYMENT CHANNELS (Bank, QR, Payment URL, USDT TRC20)
// =========================================================================
adminFinanceSystemRouter.get(
  '/deposit-channels',
  requireAdmin(['super_admin', 'admin', 'finance']),
  async (_req, res) => {
    try {
      const items = await listDepositChannels({ onlyEnabled: false });
      return res.json({ items });
    } catch (error) {
      console.error('Admin deposit channels list error:', error);
      return res.status(500).json({ error: 'Unable to load deposit payment channels.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/deposit-channels/qr-upload',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      mimeType: z.string().min(5).max(40),
      dataBase64: z.string().min(10).max(3_200_000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid QR image upload payload.' });
    }

    try {
      const saved = saveQrImageFromBase64(parsed.data);
      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'deposit_channel.qr_uploaded',
        entityType: 'deposit_channel',
        entityId: saved.filename,
        details: { qrImagePath: saved.qrImagePath, bytes: saved.bytes },
        ipAddress: req.ip,
      });
      return res.status(201).json(saved);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Unable to store QR image.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/deposit-channels',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const normalized = validateAndNormalizeChannelPayload(req.body);
      if (normalized.category === 'bank_transfer' || normalized.category === 'usdt_trc20') {
        const adminPassword = String(req.body?.adminPassword || '');
        if (!adminPassword || !verifyPassword(adminPassword, req.authUser!.passwordHash)) {
          return res.status(403).json({
            error: 'Administrator password reauthentication is required to configure bank accounts or crypto addresses.',
          });
        }
      }

      const code = `${normalized.category}_${crypto.randomBytes(3).toString('hex')}`;
      const [created] = await db
        .insert(depositChannels)
        .values({
          code,
          category: normalized.category,
          name: normalized.name,
          subtitle: normalized.subtitle,
          currency: normalized.currency,
          minAmount: normalized.minAmount.toFixed(2),
          maxAmount: normalized.maxAmount.toFixed(2),
          bonusRate: normalized.bonusRate.toFixed(2),
          presetsJson: normalized.presets,
          instructionsJson: normalized.instructions,
          detailsJson: normalized.details,
          enabled: normalized.enabled,
          version: 1,
          updatedByUserId: req.authUser!.id,
          updatedAt: new Date(),
        })
        .returning();

      const dto = mapDbChannelToDto(created);
      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'deposit_channel.created',
        entityType: 'deposit_channel',
        entityId: String(created.id),
        details: { previousConfig: null, updatedConfig: dto },
        ipAddress: req.ip,
      });

      return res.status(201).json({ channel: dto });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Invalid deposit channel configuration.' });
    }
  }
);

adminFinanceSystemRouter.patch(
  '/deposit-channels/:id',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid payment channel ID.' });
    }

    try {
      const [existing] = await db.select().from(depositChannels).where(eq(depositChannels.id, id)).limit(1);
      if (!existing) {
        return res.status(404).json({ error: 'Payment channel not found.' });
      }

      const previousDto = mapDbChannelToDto(existing);
      const normalized = validateAndNormalizeChannelPayload({
        ...req.body,
        category: existing.category,
      });

      // Require admin reauthentication when changing sensitive receiving bank account or crypto wallet address
      let sensitiveDestinationChanged = false;
      if (normalized.category === 'bank_transfer') {
        const prevAcc = (previousDto.details as any)?.accountNumber;
        const nextAcc = (normalized.details as any)?.accountNumber;
        sensitiveDestinationChanged = prevAcc !== nextAcc;
      } else if (normalized.category === 'usdt_trc20') {
        const prevAddr = (previousDto.details as any)?.walletAddress;
        const nextAddr = (normalized.details as any)?.walletAddress;
        sensitiveDestinationChanged = prevAddr !== nextAddr;
      }

      if (sensitiveDestinationChanged) {
        const adminPassword = String(req.body?.adminPassword || '');
        if (!adminPassword || !verifyPassword(adminPassword, req.authUser!.passwordHash)) {
          return res.status(403).json({
            error: 'Administrator password reauthentication is required to change receiving bank accounts or crypto wallet addresses.',
          });
        }
      }

      const [updated] = await db
        .update(depositChannels)
        .set({
          name: normalized.name,
          subtitle: normalized.subtitle,
          currency: normalized.currency,
          minAmount: normalized.minAmount.toFixed(2),
          maxAmount: normalized.maxAmount.toFixed(2),
          bonusRate: normalized.bonusRate.toFixed(2),
          presetsJson: normalized.presets,
          instructionsJson: normalized.instructions,
          detailsJson: normalized.details,
          enabled: normalized.enabled,
          version: existing.version + 1,
          updatedByUserId: req.authUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(depositChannels.id, id))
        .returning();

      const updatedDto = mapDbChannelToDto(updated);
      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: 'deposit_channel.updated',
        entityType: 'deposit_channel',
        entityId: String(id),
        details: { previousConfig: previousDto, updatedConfig: updatedDto },
        ipAddress: req.ip,
      });

      return res.json({ channel: updatedDto });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Unable to update deposit channel.' });
    }
  }
);

adminFinanceSystemRouter.post(
  '/deposit-channels/:id/toggle',
  requireAdmin(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid payment channel ID.' });
    }

    try {
      const [existing] = await db.select().from(depositChannels).where(eq(depositChannels.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Payment channel not found.' });

      const nextEnabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !existing.enabled;
      const previousDto = mapDbChannelToDto(existing);

      const [updated] = await db
        .update(depositChannels)
        .set({
          enabled: nextEnabled,
          version: existing.version + 1,
          updatedByUserId: req.authUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(depositChannels.id, id))
        .returning();

      const updatedDto = mapDbChannelToDto(updated);
      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.username || req.authUser!.email,
        action: nextEnabled ? 'deposit_channel.enabled' : 'deposit_channel.disabled',
        entityType: 'deposit_channel',
        entityId: String(id),
        details: { previousConfig: previousDto, updatedConfig: updatedDto },
        ipAddress: req.ip,
      });

      return res.json({ channel: updatedDto });
    } catch (error) {
      console.error('Toggle deposit channel error:', error);
      return res.status(500).json({ error: 'Unable to update channel status.' });
    }
  }
);
