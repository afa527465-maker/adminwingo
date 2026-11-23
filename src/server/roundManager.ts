import { and, desc, eq, lte, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bets, gameRounds, gameRulesets, platformSettings } from '../db/schema.ts';
import {
  DEFAULT_DEMO_RULESET,
  WINGO_MODES,
  classifyNumber,
  deriveWinningNumber,
  evaluateBetOutcome,
  formatMoney,
  generateSeedCommitment,
  getRoundSchedule,
  roundMoney,
  type BetCategory,
  type RulesetConfig,
  type WinGoMode,
} from './rules.ts';
import { applyWalletMutationTx, distributeReferralCommissionsTx } from './ledger.ts';

// Keep pre-committed seeds in process memory keyed by periodId until settlement reveals them.
// If process restarts before settlement, a deterministic HMAC fallback keyed by server runtime secret is used.
const pendingSeedStore = new Map<string, string>();
let activeRulesetCache: { version: string; config: RulesetConfig; ownerApprovedForProd: boolean } | null =
  null;

export async function getActiveRuleset(): Promise<{
  id: number;
  version: string;
  config: RulesetConfig;
  ownerApprovedForProd: boolean;
}> {
  try {
    const [row] = await db
      .select()
      .from(gameRulesets)
      .where(eq(gameRulesets.isActive, true))
      .orderBy(desc(gameRulesets.id))
      .limit(1);

    if (row) {
      const cfg = row.configJson as RulesetConfig;
      activeRulesetCache = {
        version: row.version,
        config: cfg,
        ownerApprovedForProd: row.ownerApprovedForProd,
      };
      return {
        id: row.id,
        version: row.version,
        config: cfg,
        ownerApprovedForProd: row.ownerApprovedForProd,
      };
    }

    const [created] = await db
      .insert(gameRulesets)
      .values({
        version: 'v1.0-standard',
        isActive: true,
        ownerApprovedForProd: false,
        configJson: DEFAULT_DEMO_RULESET,
        notes: 'Initial configurable WinGo ruleset. Super Administrator approval required before production activation.',
      })
      .onConflictDoNothing({ target: gameRulesets.version })
      .returning();

    if (created) {
      return {
        id: created.id,
        version: created.version,
        config: created.configJson as RulesetConfig,
        ownerApprovedForProd: created.ownerApprovedForProd,
      };
    }

    const [fallback] = await db
      .select()
      .from(gameRulesets)
      .orderBy(desc(gameRulesets.id))
      .limit(1);

    return {
      id: fallback.id,
      version: fallback.version,
      config: fallback.configJson as RulesetConfig,
      ownerApprovedForProd: fallback.ownerApprovedForProd,
    };
  } catch (error) {
    console.error('Failed to fetch active ruleset:', error);
    throw new Error('Unable to load active game ruleset.', { cause: error });
  }
}

export function invalidateRulesetCache() {
  activeRulesetCache = null;
}

export async function ensureRoundForTime(mode: WinGoMode, nowMs: number = Date.now()) {
  const ruleset = await getActiveRuleset();
  const schedule = getRoundSchedule(mode, nowMs, ruleset.config);

  const [existing] = await db
    .select()
    .from(gameRounds)
    .where(eq(gameRounds.periodId, schedule.periodId))
    .limit(1);

  if (existing) {
    // Update status to closed if past closesAt and still open
    if (existing.status === 'open' && nowMs >= existing.closesAt.getTime() && nowMs < existing.endsAt.getTime()) {
      const [closed] = await db
        .update(gameRounds)
        .set({ status: 'closed' })
        .where(and(eq(gameRounds.id, existing.id), eq(gameRounds.status, 'open')))
        .returning();
      return closed || existing;
    }
    return existing;
  }

  const { seed, hash } = generateSeedCommitment();
  pendingSeedStore.set(schedule.periodId, seed);

  const status = nowMs >= schedule.closesAt.getTime() ? 'closed' : 'open';

  const [created] = await db
    .insert(gameRounds)
    .values({
      periodId: schedule.periodId,
      mode,
      rulesetVersion: ruleset.version,
      status,
      startsAt: schedule.startsAt,
      closesAt: schedule.closesAt,
      endsAt: schedule.endsAt,
      serverSeedHash: hash,
    })
    .onConflictDoNothing({ target: gameRounds.periodId })
    .returning();

  if (created) return created;

  const [fetched] = await db
    .select()
    .from(gameRounds)
    .where(eq(gameRounds.periodId, schedule.periodId))
    .limit(1);
  return fetched;
}

export async function getPausedModes(): Promise<Record<WinGoMode, boolean>> {
  const defaults: Record<WinGoMode, boolean> = {
    '30s': false,
    '1m': false,
    '3m': false,
    '5m': false,
  };
  try {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'paused_modes'))
      .limit(1);
    if (row && row.valueJson && typeof row.valueJson === 'object') {
      const val = row.valueJson as Partial<Record<WinGoMode, boolean>>;
      return {
        '30s': Boolean(val['30s']),
        '1m': Boolean(val['1m']),
        '3m': Boolean(val['3m']),
        '5m': Boolean(val['5m']),
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export async function isModePaused(mode: WinGoMode): Promise<boolean> {
  const paused = await getPausedModes();
  return Boolean(paused[mode]);
}

/**
 * Atomically settles a single expired round exactly once.
 * Uses PostgreSQL FOR UPDATE lock so concurrent ticks/requests can never double-settle.
 */
export async function settleRoundById(roundId: number) {
  const ruleset = await getActiveRuleset();

  return db.transaction(async (tx) => {
    const [round] = await tx
      .select()
      .from(gameRounds)
      .where(eq(gameRounds.id, roundId))
      .for('update')
      .limit(1);

    if (!round || round.status === 'settled') {
      return round;
    }

    // Retrieve committed seed or generate fresh CSPRNG seed if process restarted mid-round
    let revealSeed = pendingSeedStore.get(round.periodId);
    let updatedHash = round.serverSeedHash;
    if (!revealSeed) {
      const fresh = generateSeedCommitment();
      revealSeed = fresh.seed;
      updatedHash = fresh.hash;
    } else {
      pendingSeedStore.delete(round.periodId);
    }

    const winningNumber = deriveWinningNumber(revealSeed, round.periodId);
    const classified = classifyNumber(winningNumber, ruleset.config);

    // Fetch all pending bets for this round
    const roundBets = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, round.id), eq(bets.status, 'pending')));

    let totalWagered = 0;
    let totalPayout = 0;

    for (const bet of roundBets) {
      const stake = parseFloat(bet.totalStake);
      const netStake = parseFloat(bet.netStake);
      totalWagered = roundMoney(totalWagered + stake);

      const evalResult = evaluateBetOutcome(
        bet.category as BetCategory,
        bet.selection,
        netStake,
        winningNumber,
        ruleset.config
      );

      totalPayout = roundMoney(totalPayout + evalResult.payout);

      await tx
        .update(bets)
        .set({
          status: evalResult.status,
          actualPayout: formatMoney(evalResult.payout),
          settledAt: new Date(),
        })
        .where(eq(bets.id, bet.id));

      // Release reserved wager balance; credit payout if won
      if (evalResult.status === 'won' && evalResult.payout > 0) {
        await applyWalletMutationTx(tx, {
          userId: bet.userId,
          type: 'payout',
          amount: evalResult.payout,
          idempotencyKey: `payout:${bet.ticketId}`,
          sourceType: 'bet',
          sourceId: bet.ticketId,
          note: `WinGo ${bet.mode} #${round.periodId} win (${bet.selection} -> #${winningNumber})`,
          reservedDelta: -stake,
          totalsDelta: { won: evalResult.payout },
        });
      } else {
        // Release reserved amount on loss (0 credit)
        await applyWalletMutationTx(tx, {
          userId: bet.userId,
          type: 'payout',
          amount: 0,
          idempotencyKey: `settle-loss:${bet.ticketId}`,
          sourceType: 'bet',
          sourceId: bet.ticketId,
          note: `WinGo ${bet.mode} #${round.periodId} settled (outcome #${winningNumber})`,
          reservedDelta: -stake,
        });
      }

      // Accrue transparent referral commissions on settled wager
      await distributeReferralCommissionsTx(tx, {
        sourceUserId: bet.userId,
        sourceRef: `bet:${bet.ticketId}`,
        baseAmount: stake,
        tier1Percent: ruleset.config.commissionRates.tier1Percent,
        tier2Percent: ruleset.config.commissionRates.tier2Percent,
      });
    }

    const [settledRound] = await tx
      .update(gameRounds)
      .set({
        status: 'settled',
        winningNumber,
        winningColors: classified.colors,
        winningSize: classified.size,
        serverSeedHash: updatedHash,
        serverSeedReveal: revealSeed,
        settledAt: new Date(),
        totalWagered: formatMoney(totalWagered),
        totalPayout: formatMoney(totalPayout),
      })
      .where(eq(gameRounds.id, round.id))
      .returning();

    return settledRound;
  });
}

let isTickRunning = false;

export async function settleDueRounds(nowMs: number = Date.now()) {
  if (isTickRunning) return;
  isTickRunning = true;
  try {
    const due = await db
      .select({ id: gameRounds.id })
      .from(gameRounds)
      .where(and(ne(gameRounds.status, 'settled'), lte(gameRounds.endsAt, new Date(nowMs))))
      .limit(20);

    for (const r of due) {
      await settleRoundById(r.id);
    }
  } catch (error) {
    console.error('Round settlement sweep error:', error);
  } finally {
    isTickRunning = false;
  }
}

export async function getLiveModeState(mode: WinGoMode) {
  const nowMs = Date.now();
  await settleDueRounds(nowMs);
  const activeRound = await ensureRoundForTime(mode, nowMs);
  const [ruleset, modePaused] = await Promise.all([getActiveRuleset(), isModePaused(mode)]);

  const recentRounds = await db
    .select()
    .from(gameRounds)
    .where(and(eq(gameRounds.mode, mode), eq(gameRounds.status, 'settled')))
    .orderBy(desc(gameRounds.endsAt))
    .limit(20);

  const remainingMs = Math.max(0, activeRound.endsAt.getTime() - nowMs);
  const cutoffRemainingMs = Math.max(0, activeRound.closesAt.getTime() - nowMs);
  const bettingOpen =
    !modePaused && nowMs < activeRound.closesAt.getTime() && activeRound.status === 'open';

  return {
    serverTimeMs: nowMs,
    mode,
    modePaused,
    modeConfig: WINGO_MODES[mode],
    ruleset: {
      version: ruleset.version,
      ownerApprovedForProd: ruleset.ownerApprovedForProd,
      config: ruleset.config,
    },
    currentRound: {
      id: activeRound.id,
      periodId: activeRound.periodId,
      status: bettingOpen ? 'open' : 'closed',
      startsAt: activeRound.startsAt.toISOString(),
      closesAt: activeRound.closesAt.toISOString(),
      endsAt: activeRound.endsAt.toISOString(),
      remainingSeconds: Math.ceil(remainingMs / 1000),
      cutoffRemainingSeconds: Math.ceil(cutoffRemainingMs / 1000),
      bettingOpen,
      serverSeedHash: activeRound.serverSeedHash,
    },
    recentResults: recentRounds.map((r) => ({
      id: r.id,
      periodId: r.periodId,
      mode: r.mode,
      winningNumber: r.winningNumber,
      winningColors: r.winningColors as string[],
      winningSize: r.winningSize,
      endsAt: r.endsAt.toISOString(),
      settledAt: r.settledAt?.toISOString() ?? null,
      serverSeedHash: r.serverSeedHash,
      serverSeedReveal: r.serverSeedReveal,
    })),
  };
}
