import crypto from 'crypto';

export type WinGoMode = '30s' | '1m' | '3m' | '5m';
export type BetCategory = 'color' | 'number' | 'size';
export type ColorSelection = 'green' | 'violet' | 'red';
export type SizeSelection = 'big' | 'small';

export interface ModeScheduleConfig {
  mode: WinGoMode;
  label: string;
  shortLabel: string;
  durationSeconds: number;
  cutoffSeconds: number;
  modeCode: string;
}

export const WINGO_MODES: Record<WinGoMode, ModeScheduleConfig> = {
  '30s': {
    mode: '30s',
    label: 'WinGo 30 Seconds',
    shortLabel: 'WinGo 30s',
    durationSeconds: 30,
    cutoffSeconds: 5,
    modeCode: '01',
  },
  '1m': {
    mode: '1m',
    label: 'WinGo 1 Minute',
    shortLabel: 'WinGo 1 Min',
    durationSeconds: 60,
    cutoffSeconds: 10,
    modeCode: '02',
  },
  '3m': {
    mode: '3m',
    label: 'WinGo 3 Minutes',
    shortLabel: 'WinGo 3 Min',
    durationSeconds: 180,
    cutoffSeconds: 15,
    modeCode: '03',
  },
  '5m': {
    mode: '5m',
    label: 'WinGo 5 Minutes',
    shortLabel: 'WinGo 5 Min',
    durationSeconds: 300,
    cutoffSeconds: 20,
    modeCode: '04',
  },
};

export interface RulesetConfig {
  label: string;
  isDemoDefaults: boolean;
  currency: string;
  feePercent: number;
  minWager: number;
  maxWager: number;
  unitPresets: number[];
  stakeMultipliers: number[];
  payoutMultipliers: {
    colorStandard: number; // Green or Red on non-violet numbers
    colorSplitViolet: number; // Green on 5 or Red on 0
    violet: number; // Violet on 0 or 5
    numberExact: number; // Exact 0..9
    bigSmall: number; // Big (5-9) or Small (0-4)
  };
  cutoffs: Record<WinGoMode, number>;
  numberMapping: Record<number, { colors: ColorSelection[]; size: SizeSelection }>;
  commissionRates: {
    tier1Percent: number;
    tier2Percent: number;
  };
  refundOnVoid: boolean;
}

export const DEFAULT_DEMO_RULESET: RulesetConfig = {
  label: 'WinGo Configurable Demo Ruleset (Requires Owner Approval Before Live Activation)',
  isDemoDefaults: true,
  currency: process.env.WINGO_CURRENCY || 'USD',
  feePercent: 2,
  minWager: 1,
  maxWager: 10000,
  unitPresets: [1, 10, 100, 1000],
  stakeMultipliers: [1, 5, 10, 20, 50, 100],
  payoutMultipliers: {
    colorStandard: 2.0,
    colorSplitViolet: 1.5,
    violet: 4.5,
    numberExact: 9.0,
    bigSmall: 2.0,
  },
  cutoffs: {
    '30s': 5,
    '1m': 10,
    '3m': 15,
    '5m': 20,
  },
  numberMapping: {
    0: { colors: ['red', 'violet'], size: 'small' },
    1: { colors: ['green'], size: 'small' },
    2: { colors: ['red'], size: 'small' },
    3: { colors: ['green'], size: 'small' },
    4: { colors: ['red'], size: 'small' },
    5: { colors: ['green', 'violet'], size: 'big' },
    6: { colors: ['red'], size: 'big' },
    7: { colors: ['green'], size: 'big' },
    8: { colors: ['red'], size: 'big' },
    9: { colors: ['green'], size: 'big' },
  },
  commissionRates: {
    tier1Percent: 0.6,
    tier2Percent: 0.25,
  },
  refundOnVoid: true,
};

export function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function formatMoney(val: number | string): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

export interface RoundSchedule {
  periodId: string;
  mode: WinGoMode;
  slotIndex: number;
  startsAt: Date;
  closesAt: Date;
  endsAt: Date;
}

/**
 * Generates deterministic, authoritative round identifiers and schedule windows
 * anchored strictly to UTC midnight so all players see the exact same periodId and countdown.
 */
export function getRoundSchedule(
  mode: WinGoMode,
  nowMs: number = Date.now(),
  ruleset: RulesetConfig = DEFAULT_DEMO_RULESET
): RoundSchedule {
  const cfg = WINGO_MODES[mode];
  const durationMs = cfg.durationSeconds * 1000;
  const cutoffSec = ruleset.cutoffs?.[mode] ?? cfg.cutoffSeconds;

  const date = new Date(nowMs);
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDay = date.getUTCDate();
  const dayStartMs = Date.UTC(utcYear, utcMonth, utcDay, 0, 0, 0, 0);

  const elapsedMs = nowMs - dayStartMs;
  const slotIndex = Math.floor(elapsedMs / durationMs) + 1;

  const startsAtMs = dayStartMs + (slotIndex - 1) * durationMs;
  const endsAtMs = startsAtMs + durationMs;
  const closesAtMs = endsAtMs - cutoffSec * 1000;

  const y = String(utcYear);
  const m = String(utcMonth + 1).padStart(2, '0');
  const d = String(utcDay).padStart(2, '0');
  const seq = String(slotIndex).padStart(4, '0');
  const periodId = `${y}${m}${d}${cfg.modeCode}${seq}`;

  return {
    periodId,
    mode,
    slotIndex,
    startsAt: new Date(startsAtMs),
    closesAt: new Date(closesAtMs),
    endsAt: new Date(endsAtMs),
  };
}

export function generateSeedCommitment(): { seed: string; hash: string } {
  const seed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return { seed, hash };
}

/**
 * Deterministically derives a winning number 0-9 from a pre-committed CSPRNG seed and periodId.
 * Uses HMAC-SHA256 with rejection-free uniform modulo over 32-bit unsigned integer.
 */
export function deriveWinningNumber(serverSeed: string, periodId: string): number {
  const digest = crypto.createHmac('sha256', serverSeed).update(`wingo:${periodId}`).digest();
  // Use first 4 bytes as unsigned 32-bit integer
  const uint32 = digest.readUInt32BE(0);
  return uint32 % 10;
}

export function verifySeedCommitment(serverSeed: string, expectedHash: string): boolean {
  const actualHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}

export function classifyNumber(
  num: number,
  ruleset: RulesetConfig = DEFAULT_DEMO_RULESET
): { colors: ColorSelection[]; size: SizeSelection } {
  const entry = ruleset.numberMapping[num];
  if (!entry) {
    throw new Error(`Invalid WinGo number: ${num}`);
  }
  return entry;
}

export function validateSelection(category: BetCategory, selection: string): boolean {
  if (category === 'color') {
    return selection === 'green' || selection === 'violet' || selection === 'red';
  }
  if (category === 'size') {
    return selection === 'big' || selection === 'small';
  }
  if (category === 'number') {
    return /^[0-9]$/.test(selection);
  }
  return false;
}

export interface BetQuote {
  unitAmount: number;
  stakeMultiplier: number;
  totalStake: number;
  feeAmount: number;
  netStake: number;
  payoutMultiplier: number;
  splitPayoutMultiplier: number | null;
  potentialPayout: number;
}

export function calculateBetQuote(
  category: BetCategory,
  selection: string,
  unitAmount: number,
  stakeMultiplier: number,
  ruleset: RulesetConfig = DEFAULT_DEMO_RULESET
): BetQuote {
  if (!validateSelection(category, selection)) {
    throw new Error('Invalid betting selection');
  }
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    throw new Error('Invalid unit amount');
  }
  if (!Number.isInteger(stakeMultiplier) || stakeMultiplier < 1 || stakeMultiplier > 1000) {
    throw new Error('Invalid stake multiplier');
  }

  const totalStake = roundMoney(unitAmount * stakeMultiplier);
  if (totalStake < ruleset.minWager) {
    throw new Error(`Minimum wager is ${ruleset.minWager}`);
  }
  if (totalStake > ruleset.maxWager) {
    throw new Error(`Maximum wager is ${ruleset.maxWager}`);
  }

  const feeAmount = roundMoney(totalStake * (ruleset.feePercent / 100));
  const netStake = roundMoney(totalStake - feeAmount);

  let payoutMultiplier = ruleset.payoutMultipliers.bigSmall;
  let splitPayoutMultiplier: number | null = null;

  if (category === 'color') {
    if (selection === 'violet') {
      payoutMultiplier = ruleset.payoutMultipliers.violet;
    } else {
      payoutMultiplier = ruleset.payoutMultipliers.colorStandard;
      splitPayoutMultiplier = ruleset.payoutMultipliers.colorSplitViolet;
    }
  } else if (category === 'number') {
    payoutMultiplier = ruleset.payoutMultipliers.numberExact;
  } else if (category === 'size') {
    payoutMultiplier = ruleset.payoutMultipliers.bigSmall;
  }

  const potentialPayout = roundMoney(netStake * payoutMultiplier);

  return {
    unitAmount: roundMoney(unitAmount),
    stakeMultiplier,
    totalStake,
    feeAmount,
    netStake,
    payoutMultiplier,
    splitPayoutMultiplier,
    potentialPayout,
  };
}

export interface BetEvaluation {
  status: 'won' | 'lost';
  appliedMultiplier: number;
  payout: number;
}

export function evaluateBetOutcome(
  category: BetCategory,
  selection: string,
  netStake: number,
  winningNumber: number,
  ruleset: RulesetConfig = DEFAULT_DEMO_RULESET
): BetEvaluation {
  const outcome = classifyNumber(winningNumber, ruleset);

  if (category === 'number') {
    if (String(winningNumber) === selection) {
      const mult = ruleset.payoutMultipliers.numberExact;
      return { status: 'won', appliedMultiplier: mult, payout: roundMoney(netStake * mult) };
    }
    return { status: 'lost', appliedMultiplier: 0, payout: 0 };
  }

  if (category === 'size') {
    if (outcome.size === selection) {
      const mult = ruleset.payoutMultipliers.bigSmall;
      return { status: 'won', appliedMultiplier: mult, payout: roundMoney(netStake * mult) };
    }
    return { status: 'lost', appliedMultiplier: 0, payout: 0 };
  }

  if (category === 'color') {
    if (selection === 'violet') {
      if (outcome.colors.includes('violet')) {
        const mult = ruleset.payoutMultipliers.violet;
        return { status: 'won', appliedMultiplier: mult, payout: roundMoney(netStake * mult) };
      }
      return { status: 'lost', appliedMultiplier: 0, payout: 0 };
    }
    if (selection === 'green' || selection === 'red') {
      if (outcome.colors.includes(selection)) {
        const isSplit = outcome.colors.includes('violet');
        const mult = isSplit
          ? ruleset.payoutMultipliers.colorSplitViolet
          : ruleset.payoutMultipliers.colorStandard;
        return { status: 'won', appliedMultiplier: mult, payout: roundMoney(netStake * mult) };
      }
      return { status: 'lost', appliedMultiplier: 0, payout: 0 };
    }
  }

  return { status: 'lost', appliedMultiplier: 0, payout: 0 };
}
