import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  wallets,
  ledgerTransactions,
  auditLogs,
  users,
  commissions,
} from '../db/schema.ts';
import { generateRef } from './crypto.ts';
import { formatMoney, roundMoney } from './rules.ts';

export type LedgerTxType =
  | 'deposit'
  | 'withdrawal'
  | 'withdrawal_refund'
  | 'wager'
  | 'payout'
  | 'wager_refund'
  | 'gift_bonus'
  | 'commission'
  | 'admin_adjustment';

export async function ensureWallet(userId: number, currency = process.env.WINGO_CURRENCY || 'USD') {
  try {
    const [existing] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (existing) return existing;

    const [created] = await db
      .insert(wallets)
      .values({
        userId,
        currency,
        availableBalance: '0.00',
        reservedBalance: '0.00',
      })
      .onConflictDoNothing({ target: wallets.userId })
      .returning();

    if (created) return created;
    const [fallback] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    return fallback;
  } catch (error) {
    console.error('Failed to ensure wallet:', error);
    throw new Error('Wallet initialization failed. Please try again.', { cause: error });
  }
}

export interface WalletMutationInput {
  userId: number;
  type: LedgerTxType;
  amount: number; // positive credits, negative debits
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  note?: string;
  reservedDelta?: number;
  totalsDelta?: {
    deposited?: number;
    withdrawn?: number;
    wagered?: number;
    won?: number;
  };
}

/**
 * Executes an atomic, idempotent, row-locked wallet mutation and writes an immutable ledger record.
 * Guarantees no negative available balance and zero duplicate deductions/payouts.
 */
export async function applyWalletMutationTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: WalletMutationInput
) {
  // Check idempotency first
  const [existingTx] = await tx
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingTx) {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, input.userId)).limit(1);
    return { transaction: existingTx, wallet, duplicate: true };
  }

  // Lock wallet row FOR UPDATE
  let [wallet] = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, input.userId))
    .for('update')
    .limit(1);

  if (!wallet) {
    [wallet] = await tx
      .insert(wallets)
      .values({
        userId: input.userId,
        currency: process.env.WINGO_CURRENCY || 'USD',
        availableBalance: '0.00',
        reservedBalance: '0.00',
      })
      .returning();
  }

  const currentAvailable = parseFloat(wallet.availableBalance);
  const currentReserved = parseFloat(wallet.reservedBalance);
  const delta = roundMoney(input.amount);
  const nextAvailable = roundMoney(currentAvailable + delta);
  const nextReserved = roundMoney(Math.max(0, currentReserved + (input.reservedDelta ?? 0)));

  if (nextAvailable < 0) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  const nextDeposited = roundMoney(
    parseFloat(wallet.totalDeposited) + (input.totalsDelta?.deposited ?? 0)
  );
  const nextWithdrawn = roundMoney(
    parseFloat(wallet.totalWithdrawn) + (input.totalsDelta?.withdrawn ?? 0)
  );
  const nextWagered = roundMoney(
    parseFloat(wallet.totalWagered) + (input.totalsDelta?.wagered ?? 0)
  );
  const nextWon = roundMoney(parseFloat(wallet.totalWon) + (input.totalsDelta?.won ?? 0));

  const [updatedWallet] = await tx
    .update(wallets)
    .set({
      availableBalance: formatMoney(nextAvailable),
      reservedBalance: formatMoney(nextReserved),
      totalDeposited: formatMoney(nextDeposited),
      totalWithdrawn: formatMoney(nextWithdrawn),
      totalWagered: formatMoney(nextWagered),
      totalWon: formatMoney(nextWon),
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, wallet.id))
    .returning();

  const txRef = generateRef('TXN');
  const [ledgerRow] = await tx
    .insert(ledgerTransactions)
    .values({
      txRef,
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      type: input.type,
      amount: formatMoney(delta),
      balanceBefore: formatMoney(currentAvailable),
      balanceAfter: formatMoney(nextAvailable),
      status: 'completed',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      note: input.note ?? null,
    })
    .returning();

  return { transaction: ledgerRow, wallet: updatedWallet, duplicate: false };
}

export async function applyWalletMutation(input: WalletMutationInput) {
  return db.transaction(async (tx) => applyWalletMutationTx(tx, input));
}

/**
 * Credits tier-1 (direct) and tier-2 (team) referral commissions on settled wagers.
 * Strictly guards against self-referrals, cycles, and duplicate rewards.
 */
export async function distributeReferralCommissionsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    sourceUserId: number;
    sourceRef: string;
    baseAmount: number;
    tier1Percent: number;
    tier2Percent: number;
  }
) {
  if (params.baseAmount <= 0) return;

  const [sourceUser] = await tx
    .select({ id: users.id, referredById: users.referredById })
    .from(users)
    .where(eq(users.id, params.sourceUserId))
    .limit(1);

  if (!sourceUser || !sourceUser.referredById || sourceUser.referredById === sourceUser.id) {
    return;
  }

  const visited = new Set<number>([sourceUser.id]);
  const tier1Id = sourceUser.referredById;
  if (visited.has(tier1Id)) return;
  visited.add(tier1Id);

  const tier1Amount = roundMoney(params.baseAmount * (params.tier1Percent / 100));
  if (tier1Amount >= 0.01) {
    const ref1 = `${params.sourceRef}:T1:${tier1Id}`;
    const [inserted] = await tx
      .insert(commissions)
      .values({
        agentUserId: tier1Id,
        sourceUserId: params.sourceUserId,
        tier: 1,
        sourceType: 'wager',
        sourceRef: ref1,
        baseAmount: formatMoney(params.baseAmount),
        ratePercent: params.tier1Percent.toFixed(3),
        commissionAmount: formatMoney(tier1Amount),
      })
      .onConflictDoNothing({ target: commissions.sourceRef })
      .returning();

    if (inserted) {
      await applyWalletMutationTx(tx, {
        userId: tier1Id,
        type: 'commission',
        amount: tier1Amount,
        idempotencyKey: `comm:${ref1}`,
        sourceType: 'commission',
        sourceId: ref1,
        note: `Tier 1 direct referral commission (${params.tier1Percent}%)`,
      });
    }
  }

  // Tier 2 upline
  const [tier1User] = await tx
    .select({ id: users.id, referredById: users.referredById })
    .from(users)
    .where(eq(users.id, tier1Id))
    .limit(1);

  if (tier1User?.referredById && !visited.has(tier1User.referredById)) {
    const tier2Id = tier1User.referredById;
    const tier2Amount = roundMoney(params.baseAmount * (params.tier2Percent / 100));
    if (tier2Amount >= 0.01) {
      const ref2 = `${params.sourceRef}:T2:${tier2Id}`;
      const [inserted2] = await tx
        .insert(commissions)
        .values({
          agentUserId: tier2Id,
          sourceUserId: params.sourceUserId,
          tier: 2,
          sourceType: 'wager',
          sourceRef: ref2,
          baseAmount: formatMoney(params.baseAmount),
          ratePercent: params.tier2Percent.toFixed(3),
          commissionAmount: formatMoney(tier2Amount),
        })
        .onConflictDoNothing({ target: commissions.sourceRef })
        .returning();

      if (inserted2) {
        await applyWalletMutationTx(tx, {
          userId: tier2Id,
          type: 'commission',
          amount: tier2Amount,
          idempotencyKey: `comm:${ref2}`,
          sourceType: 'commission',
          sourceId: ref2,
          note: `Tier 2 team referral commission (${params.tier2Percent}%)`,
        });
      }
    }
  }
}

export async function recordAuditLog(params: {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      detailsJson: params.details ?? null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function reconcileWalletLedger(userId?: number) {
  try {
    const condition = userId ? sql`WHERE w.user_id = ${userId}` : sql``;
    const rows = await db.execute(sql`
      SELECT
        w.user_id,
        w.available_balance,
        COALESCE(SUM(lt.amount), 0)::numeric(18,2) AS ledger_sum,
        (w.available_balance - COALESCE(SUM(lt.amount), 0))::numeric(18,2) AS discrepancy
      FROM wallets w
      LEFT JOIN ledger_transactions lt ON lt.user_id = w.user_id
      ${condition}
      GROUP BY w.user_id, w.available_balance
      ORDER BY w.user_id ASC
    `);
    return rows.rows;
  } catch (error) {
    console.error('Reconciliation query failed:', error);
    throw new Error('Failed to run ledger reconciliation', { cause: error });
  }
}
