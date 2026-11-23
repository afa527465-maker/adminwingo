import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { bets, gameRounds } from '../../db/schema.ts';
import {
  WINGO_MODES,
  calculateBetQuote,
  formatMoney,
  type BetCategory,
  type WinGoMode,
} from '../rules.ts';
import {
  ensureRoundForTime,
  getActiveRuleset,
  getLiveModeState,
  isModePaused,
  settleDueRounds,
} from '../roundManager.ts';
import { applyWalletMutationTx } from '../ledger.ts';
import { createRateLimiter, generateRef } from '../crypto.ts';
import {
  requireAuth,
  requireVerifiedAccount,
  type AuthenticatedRequest,
} from '../auth.ts';

export const gameRouter = Router();

const betLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40, label: 'bet' });

const placeBetSchema = z.object({
  mode: z.enum(['30s', '1m', '3m', '5m']),
  periodId: z.string().min(8).max(32),
  category: z.enum(['color', 'number', 'size']),
  selection: z.string().min(1).max(12),
  unitAmount: z.number().positive(),
  multiplier: z.number().int().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(96),
});

gameRouter.get('/state/:mode', async (req, res) => {
  const mode = req.params.mode as WinGoMode;
  if (!WINGO_MODES[mode]) {
    return res.status(400).json({ error: 'Invalid WinGo mode. Expected 30s, 1m, 3m, or 5m.' });
  }

  try {
    const state = await getLiveModeState(mode);
    return res.json(state);
  } catch (error) {
    console.error('Get game state error:', error);
    return res.status(500).json({ error: 'Unable to load active WinGo round.' });
  }
});

gameRouter.get('/history', async (req, res) => {
  const mode = (req.query.mode as WinGoMode) || '30s';
  if (!WINGO_MODES[mode]) {
    return res.status(400).json({ error: 'Invalid WinGo mode.' });
  }
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(5, parseInt(String(req.query.pageSize || '15'), 10) || 15));
  const search = String(req.query.search || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();

  try {
    await settleDueRounds();

    const conditions = [eq(gameRounds.mode, mode), eq(gameRounds.status, 'settled')];
    if (search) {
      conditions.push(ilike(gameRounds.periodId, `%${search}%`));
    }
    if (dateFrom && !Number.isNaN(Date.parse(dateFrom))) {
      conditions.push(gte(gameRounds.endsAt, new Date(dateFrom)));
    }
    if (dateTo && !Number.isNaN(Date.parse(dateTo))) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(gameRounds.endsAt, endDate));
    }

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(gameRounds)
      .where(whereClause);

    const items = await db
      .select()
      .from(gameRounds)
      .where(whereClause)
      .orderBy(desc(gameRounds.endsAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // Summary stats over last 100 settled rounds for this mode
    const recent100 = await db
      .select({
        winningNumber: gameRounds.winningNumber,
        winningColors: gameRounds.winningColors,
        winningSize: gameRounds.winningSize,
      })
      .from(gameRounds)
      .where(and(eq(gameRounds.mode, mode), eq(gameRounds.status, 'settled')))
      .orderBy(desc(gameRounds.endsAt))
      .limit(100);

    const numberCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    let greenCount = 0;
    let redCount = 0;
    let violetCount = 0;
    let bigCount = 0;
    let smallCount = 0;

    for (const r of recent100) {
      if (typeof r.winningNumber === 'number') {
        numberCounts[r.winningNumber] = (numberCounts[r.winningNumber] || 0) + 1;
      }
      const colors = (r.winningColors as string[]) || [];
      if (colors.includes('green')) greenCount++;
      if (colors.includes('red')) redCount++;
      if (colors.includes('violet')) violetCount++;
      if (r.winningSize === 'big') bigCount++;
      if (r.winningSize === 'small') smallCount++;
    }

    return res.json({
      mode,
      page,
      pageSize,
      total: countRow?.total || 0,
      items: items.map((r) => ({
        id: r.id,
        periodId: r.periodId,
        mode: r.mode,
        rulesetVersion: r.rulesetVersion,
        winningNumber: r.winningNumber,
        winningColors: r.winningColors as string[],
        winningSize: r.winningSize,
        endsAt: r.endsAt.toISOString(),
        settledAt: r.settledAt?.toISOString() ?? null,
        serverSeedHash: r.serverSeedHash,
        serverSeedReveal: r.serverSeedReveal,
      })),
      stats: {
        sampleSize: recent100.length,
        numberCounts,
        colors: { green: greenCount, red: redCount, violet: violetCount },
        sizes: { big: bigCount, small: smallCount },
      },
    });
  } catch (error) {
    console.error('Game history error:', error);
    return res.status(500).json({ error: 'Unable to load official result history.' });
  }
});

gameRouter.post(
  '/bet',
  requireAuth,
  requireVerifiedAccount,
  betLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid bet payload.' });
    }

    const data = parsed.data;
    const nowMs = Date.now();

    try {
      await settleDueRounds(nowMs);
      const activeRound = await ensureRoundForTime(data.mode, nowMs);
      const ruleset = await getActiveRuleset();

      if (await isModePaused(data.mode)) {
        return res.status(409).json({
          error: 'Betting is temporarily paused for this WinGo mode by platform operations.',
          code: 'MODE_PAUSED',
        });
      }

      // Strictly reject delayed browser requests for older rounds or past server cutoff
      if (activeRound.periodId !== data.periodId) {
        return res.status(409).json({
          error: 'Round period has already transitioned. Please place your bet on the active round.',
          activePeriodId: activeRound.periodId,
        });
      }
      if (nowMs >= activeRound.closesAt.getTime() || activeRound.status !== 'open') {
        return res.status(409).json({
          error: 'Betting is closed for this round. Wait for the next round to open.',
          code: 'BETTING_CLOSED',
        });
      }

      let quote;
      try {
        quote = calculateBetQuote(
          data.category as BetCategory,
          data.selection.toLowerCase(),
          data.unitAmount,
          data.multiplier,
          ruleset.config
        );
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Invalid wager parameters.' });
      }

      const result = await db.transaction(async (tx) => {
        // Idempotent duplicate bet guard
        const [existingBet] = await tx
          .select()
          .from(bets)
          .where(eq(bets.idempotencyKey, data.idempotencyKey))
          .limit(1);

        if (existingBet) {
          return { bet: existingBet, duplicate: true };
        }

        // Re-verify round state inside transaction
        const [lockedRound] = await tx
          .select()
          .from(gameRounds)
          .where(eq(gameRounds.id, activeRound.id))
          .limit(1);

        if (!lockedRound || Date.now() >= lockedRound.closesAt.getTime() || lockedRound.status !== 'open') {
          throw new Error('BETTING_CLOSED');
        }

        const ticketId = generateRef('WG');

        const { wallet } = await applyWalletMutationTx(tx, {
          userId: req.authUser!.id,
          type: 'wager',
          amount: -quote.totalStake,
          idempotencyKey: `wager:${data.idempotencyKey}`,
          sourceType: 'bet',
          sourceId: ticketId,
          note: `WinGo ${data.mode} #${lockedRound.periodId} (${data.category}: ${data.selection.toUpperCase()})`,
          reservedDelta: quote.totalStake,
          totalsDelta: { wagered: quote.totalStake },
        });

        const [createdBet] = await tx
          .insert(bets)
          .values({
            ticketId,
            idempotencyKey: data.idempotencyKey,
            userId: req.authUser!.id,
            roundId: lockedRound.id,
            periodId: lockedRound.periodId,
            mode: data.mode,
            category: data.category,
            selection: data.selection.toLowerCase(),
            unitAmount: formatMoney(quote.unitAmount),
            multiplier: quote.stakeMultiplier,
            totalStake: formatMoney(quote.totalStake),
            feeAmount: formatMoney(quote.feeAmount),
            netStake: formatMoney(quote.netStake),
            payoutMultiplier: quote.payoutMultiplier.toFixed(2),
            potentialPayout: formatMoney(quote.potentialPayout),
            actualPayout: '0.00',
            status: 'pending',
          })
          .returning();

        return { bet: createdBet, wallet, duplicate: false };
      });

      return res.status(result.duplicate ? 200 : 201).json({
        message: result.duplicate ? 'Bet already accepted.' : 'Bet placed successfully.',
        duplicate: result.duplicate,
        bet: result.bet,
        wallet: result.wallet,
      });
    } catch (error: any) {
      if (error?.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'Insufficient available wallet balance for this wager.' });
      }
      if (error?.message === 'BETTING_CLOSED') {
        return res.status(409).json({ error: 'Betting is closed for this round.' });
      }
      console.error('Place bet error:', error);
      return res.status(500).json({ error: 'Unable to place wager right now.' });
    }
  }
);

gameRouter.get('/my-bets', requireAuth, async (req: AuthenticatedRequest, res) => {
  const mode = String(req.query.mode || 'all');
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(5, parseInt(String(req.query.pageSize || '15'), 10) || 15));

  try {
    await settleDueRounds();

    const conditions = [eq(bets.userId, req.authUser!.id)];
    if (mode !== 'all' && WINGO_MODES[mode as WinGoMode]) {
      conditions.push(eq(bets.mode, mode));
    }
    if (['pending', 'won', 'lost', 'refunded'].includes(status)) {
      conditions.push(eq(bets.status, status));
    }
    if (search) {
      conditions.push(ilike(bets.periodId, `%${search}%`));
    }

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(bets)
      .where(whereClause);

    const rows = await db
      .select({
        bet: bets,
        winningNumber: gameRounds.winningNumber,
        winningColors: gameRounds.winningColors,
        winningSize: gameRounds.winningSize,
      })
      .from(bets)
      .leftJoin(gameRounds, eq(bets.roundId, gameRounds.id))
      .where(whereClause)
      .orderBy(desc(bets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return res.json({
      page,
      pageSize,
      total: countRow?.total || 0,
      items: rows.map(({ bet, winningNumber, winningColors, winningSize }) => {
        const stake = parseFloat(bet.totalStake);
        const payout = parseFloat(bet.actualPayout);
        const netWinLoss =
          bet.status === 'pending'
            ? 0
            : bet.status === 'refunded'
              ? 0
              : Math.round((payout - stake) * 100) / 100;

        return {
          ...bet,
          netWinLoss: formatMoney(netWinLoss),
          roundOutcome:
            winningNumber !== null && winningNumber !== undefined
              ? { winningNumber, winningColors, winningSize }
              : null,
        };
      }),
    });
  } catch (error) {
    console.error('My bets error:', error);
    return res.status(500).json({ error: 'Unable to load betting history.' });
  }
});
