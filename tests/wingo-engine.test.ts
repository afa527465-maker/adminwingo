import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DEMO_RULESET,
  WINGO_MODES,
  calculateBetQuote,
  classifyNumber,
  deriveWinningNumber,
  evaluateBetOutcome,
  generateSeedCommitment,
  getRoundSchedule,
  verifySeedCommitment,
  type WinGoMode,
} from '../src/server/rules.ts';
import {
  decryptSensitive,
  encryptSensitive,
  hashPassword,
  maskAccountNumber,
  verifyPassword,
} from '../src/server/crypto.ts';

test('Round schedule generates contiguous authoritative period IDs for all 4 modes', () => {
  const modes: WinGoMode[] = ['30s', '1m', '3m', '5m'];
  const baseTime = Date.UTC(2026, 10, 21, 12, 0, 5);

  for (const mode of modes) {
    const durationMs = WINGO_MODES[mode].durationSeconds * 1000;
    const r1 = getRoundSchedule(mode, baseTime);
    const r2 = getRoundSchedule(mode, baseTime + durationMs);

    assert.equal(r2.slotIndex, r1.slotIndex + 1, `Mode ${mode} must advance sequentially without skipping`);
    assert.equal(r2.startsAt.getTime(), r1.endsAt.getTime(), `Mode ${mode} must be contiguous`);
    assert.ok(r1.closesAt.getTime() < r1.endsAt.getTime(), `Mode ${mode} must enforce cutoff before draw`);
    assert.equal(
      r1.endsAt.getTime() - r1.closesAt.getTime(),
      DEFAULT_DEMO_RULESET.cutoffs[mode] * 1000
    );
  }
});

test('Seed commitment and deterministic winning number derivation are verifiable and immutable', () => {
  const { seed, hash } = generateSeedCommitment();
  assert.equal(verifySeedCommitment(seed, hash), true);
  assert.equal(verifySeedCommitment('tampered-seed', hash), false);

  const periodId = '20261121010145';
  const n1 = deriveWinningNumber(seed, periodId);
  const n2 = deriveWinningNumber(seed, periodId);
  assert.equal(n1, n2);
  assert.ok(Number.isInteger(n1) && n1 >= 0 && n1 <= 9);
});

test('Number classification accurately maps colors and Big/Small ranges', () => {
  assert.deepEqual(classifyNumber(0), { colors: ['red', 'violet'], size: 'small' });
  assert.deepEqual(classifyNumber(1), { colors: ['green'], size: 'small' });
  assert.deepEqual(classifyNumber(4), { colors: ['red'], size: 'small' });
  assert.deepEqual(classifyNumber(5), { colors: ['green', 'violet'], size: 'big' });
  assert.deepEqual(classifyNumber(8), { colors: ['red'], size: 'big' });
  assert.deepEqual(classifyNumber(9), { colors: ['green'], size: 'big' });
});

test('Bet quote clearly separates stake multiplier from payout odds and rejects invalid stakes', () => {
  const quote = calculateBetQuote('color', 'green', 10, 5, DEFAULT_DEMO_RULESET);
  assert.equal(quote.totalStake, 50);
  assert.equal(quote.feeAmount, 1);
  assert.equal(quote.netStake, 49);
  assert.equal(quote.payoutMultiplier, 2.0);
  assert.equal(quote.splitPayoutMultiplier, 1.5);
  assert.equal(quote.potentialPayout, 98);

  assert.throws(() => calculateBetQuote('color', 'blue', 10, 1));
  assert.throws(() => calculateBetQuote('number', '10', 10, 1));
  assert.throws(() => calculateBetQuote('size', 'big', 0, 1));
  assert.throws(() => calculateBetQuote('size', 'big', 500, 100)); // exceeds maxWager 10000
});

test('Settlement calculations handle standard colors, violet splits, exact numbers, and Big/Small', () => {
  // Green bet on pure green (3) -> 2.0x
  assert.deepEqual(evaluateBetOutcome('color', 'green', 98, 3), {
    status: 'won',
    appliedMultiplier: 2.0,
    payout: 196,
  });

  // Green bet on split violet (5) -> 1.5x
  assert.deepEqual(evaluateBetOutcome('color', 'green', 98, 5), {
    status: 'won',
    appliedMultiplier: 1.5,
    payout: 147,
  });

  // Red bet on split violet (0) -> 1.5x
  assert.deepEqual(evaluateBetOutcome('color', 'red', 100, 0), {
    status: 'won',
    appliedMultiplier: 1.5,
    payout: 150,
  });

  // Violet bet on 0 -> 4.5x
  assert.deepEqual(evaluateBetOutcome('color', 'violet', 100, 0), {
    status: 'won',
    appliedMultiplier: 4.5,
    payout: 450,
  });

  // Exact number 7 -> 9.0x
  assert.deepEqual(evaluateBetOutcome('number', '7', 100, 7), {
    status: 'won',
    appliedMultiplier: 9.0,
    payout: 900,
  });

  // Big (5-9) on 6 -> 2.0x; Small (0-4) on 6 -> lost
  assert.deepEqual(evaluateBetOutcome('size', 'big', 100, 6), {
    status: 'won',
    appliedMultiplier: 2.0,
    payout: 200,
  });
  assert.deepEqual(evaluateBetOutcome('size', 'small', 100, 6), {
    status: 'lost',
    appliedMultiplier: 0,
    payout: 0,
  });
});

test('Cryptographic helpers hash passwords and encrypt/mask bank account numbers securely', () => {
  const hash = hashPassword('WinGoPass2026!');
  assert.equal(verifyPassword('WinGoPass2026!', hash), true);
  assert.equal(verifyPassword('WrongPass2026!', hash), false);

  const rawAcct = '4029100088472910';
  const encrypted = encryptSensitive(rawAcct);
  assert.notEqual(encrypted, rawAcct);
  assert.equal(decryptSensitive(encrypted), rawAcct);
  assert.equal(maskAccountNumber(rawAcct), '************2910');
});
