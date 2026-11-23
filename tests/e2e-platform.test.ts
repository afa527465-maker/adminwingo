import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';
import {
  auditLogs,
  bankAccounts,
  bets,
  depositRequests,
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
} from '../src/db/schema.ts';
import { authRouter } from '../src/server/routes/authRoutes.ts';
import { gameRouter } from '../src/server/routes/gameRoutes.ts';
import { walletRouter } from '../src/server/routes/walletRoutes.ts';
import { communityRouter } from '../src/server/routes/communityRoutes.ts';
import { adminRouter } from '../src/server/routes/adminRoutes.ts';
import { hashPassword } from '../src/server/crypto.ts';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/public/announcement', async (_req, res) => {
    const [listRow] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'announcements_list'))
      .limit(1);
    const active =
      listRow && Array.isArray(listRow.valueJson)
        ? (listRow.valueJson as any[]).find((a) => a.enabled && a.content)
        : null;
    res.json({
      announcement: { text: active?.content || 'default', enabled: Boolean(active) },
    });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/game', gameRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api', communityRouter);
  app.use('/api/admin', adminRouter);
  return app;
}

async function api(baseUrl: string, path: string, init: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('WinGo Platform End-to-End Real PostgreSQL Functional Suite', async (t) => {
  const app = createTestApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const suffix = crypto.randomBytes(4).toString('hex');
  const createdUserIds: number[] = [];
  const createdGiftCodeIds: number[] = [];
  let createdAnnouncementId: string | null = null;
  let originalSettingsBackup: Record<string, unknown> = {};

  // Snapshot platform settings we may touch so cleanup restores exact state
  const watchedKeys = ['paused_modes', 'announcements_list', 'announcement', 'payment_channels', 'withdrawal_rail'];
  const existingSettings = await db
    .select()
    .from(platformSettings)
    .where(inArray(platformSettings.key, watchedKeys));
  for (const row of existingSettings) {
    originalSettingsBackup[row.key] = row.valueJson;
  }

  let adminToken = '';
  let adminUserId = 0;
  let playerToken = '';
  let playerUserId = 0;
  const playerEmail = `e2e_${suffix}@wingo-test.invalid`;
  const playerPass1 = `PlayPass_${suffix}1`;
  const playerPass2 = `PlayPass_${suffix}2`;
  const adminPass1 = `AdminPass_${suffix}1`;
  const adminPass2 = `AdminPass_${suffix}2`;

  try {
    // 1. Check whether Afa exists; test bootstrap if clean, else create isolated temp super_admin for E2E
    await t.test('1. Super Admin authentication, bootstrap lock & password change', async () => {
      const statusRes = await api(baseUrl, '/api/auth/admin-bootstrap-status');
      assert.equal(statusRes.status, 200);

      if (statusRes.body.requiresClaim) {
        // Reject non-Afa username on bootstrap
        const badBoot = await api(baseUrl, '/api/auth/admin-bootstrap', {
          method: 'POST',
          body: JSON.stringify({
            username: 'WrongAdmin',
            password: adminPass1,
            confirmPassword: adminPass1,
          }),
        });
        assert.equal(badBoot.status, 400);

        // Initialize Afa once
        const boot = await api(baseUrl, '/api/auth/admin-bootstrap', {
          method: 'POST',
          body: JSON.stringify({
            username: 'Afa',
            email: `afa_${suffix}@wingo-test.invalid`,
            password: adminPass1,
            confirmPassword: adminPass1,
          }),
        });
        assert.equal(boot.status, 201, `Expected 201 bootstrap, got ${boot.status}: ${JSON.stringify(boot.body)}`);
        adminToken = boot.body.token;
        adminUserId = boot.body.user.id;
        createdUserIds.push(adminUserId);
        assert.equal(boot.body.user.username, 'Afa');
        assert.equal(boot.body.user.role, 'super_admin');

        // Confirm second bootstrap attempt is permanently locked
        const secondBoot = await api(baseUrl, '/api/auth/admin-bootstrap', {
          method: 'POST',
          body: JSON.stringify({
            username: 'Afa',
            password: adminPass1,
            confirmPassword: adminPass1,
          }),
        });
        assert.equal(secondBoot.status, 403);
      } else {
        // An Afa account already exists in DB — insert an isolated temporary super_admin for E2E testing
        const [tempAdmin] = await db
          .insert(users)
          .values({
            uid: `e2e_admin_${suffix}`,
            username: `e2e_admin_${suffix}`,
            displayName: 'E2E Test Super Admin',
            email: `e2e_admin_${suffix}@wingo-test.invalid`,
            passwordHash: hashPassword(adminPass1),
            role: 'super_admin',
            status: 'active',
            isVerified: true,
            ageConfirmed: true,
            jurisdictionCode: 'GLOBAL',
            inviteCode: `E2A${suffix.slice(0, 5).toUpperCase()}`,
          })
          .returning();
        adminUserId = tempAdmin.id;
        createdUserIds.push(adminUserId);

        const loginRes = await api(baseUrl, '/api/auth/admin-login', {
          method: 'POST',
          body: JSON.stringify({ identifier: tempAdmin.username, password: adminPass1 }),
        });
        assert.equal(loginRes.status, 200);
        adminToken = loginRes.body.token;
      }

      // Test admin login with exact credentials + wrong password rejection
      const adminUsername = statusRes.body.requiresClaim ? 'Afa' : `e2e_admin_${suffix}`;
      const wrongLogin = await api(baseUrl, '/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ identifier: adminUsername, password: 'WrongPassword99!' }),
      });
      assert.equal(wrongLogin.status, 401);

      // Test secure password change
      const chPass = await api(
        baseUrl,
        '/api/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: adminPass1,
            newPassword: adminPass2,
            confirmPassword: adminPass2,
          }),
        },
        adminToken
      );
      assert.equal(chPass.status, 200);

      // Re-login with new password
      const reLogin = await api(baseUrl, '/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ identifier: adminUsername, password: adminPass2 }),
      });
      assert.equal(reLogin.status, 200);
      adminToken = reLogin.body.token;
    });

    // 2. Real player registration, verification provider honesty, admin activation, suspension, RBAC
    await t.test('2. Real player registration, persistence, verification, suspension & RBAC', async () => {
      const reg = await api(baseUrl, '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          method: 'email',
          email: playerEmail,
          displayName: `E2E Player ${suffix}`,
          password: playerPass1,
          confirmPassword: playerPass1,
          ageConfirmed: true,
          acceptedTerms: true,
        }),
      });
      assert.equal(reg.status, 201, `Register failed: ${JSON.stringify(reg.body)}`);
      playerUserId = reg.body.user.id;
      createdUserIds.push(playerUserId);
      assert.equal(reg.body.user.status, 'pending_verification');
      assert.equal(reg.body.verificationProviderConfigured, false);
      assert.equal('devVerificationCode' in reg.body, false, 'Must NEVER expose devVerificationCode');

      // Duplicate registration rejected
      const dup = await api(baseUrl, '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          method: 'email',
          email: playerEmail,
          displayName: `E2E Player ${suffix}`,
          password: playerPass1,
          confirmPassword: playerPass1,
          ageConfirmed: true,
          acceptedTerms: true,
        }),
      });
      assert.equal(dup.status, 409);

      // Unverified login blocked honestly
      const unverifiedLogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ method: 'email', email: playerEmail, password: playerPass1 }),
      });
      assert.equal(unverifiedLogin.status, 403);

      // Admin sees player in Player Management and activates/verifies them
      const listRes = await api(baseUrl, `/api/admin/players?email=${encodeURIComponent(playerEmail)}`, {}, adminToken);
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.items.length, 1);

      const activate = await api(
        baseUrl,
        `/api/admin/players/${playerUserId}`,
        { method: 'PATCH', body: JSON.stringify({ isVerified: true, status: 'active' }) },
        adminToken
      );
      assert.equal(activate.status, 200);

      // Player logs in cleanly
      const login = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ method: 'email', email: playerEmail, password: playerPass1 }),
      });
      assert.equal(login.status, 200);
      playerToken = login.body.token;

      // RBAC: Player MUST NOT access Admin Panel endpoints
      const forbidden = await api(baseUrl, '/api/admin/dashboard', {}, playerToken);
      assert.equal(forbidden.status, 403);

      // Player updates profile & changes password
      const prof = await api(
        baseUrl,
        '/api/auth/profile',
        { method: 'PATCH', body: JSON.stringify({ displayName: `Updated ${suffix}` }) },
        playerToken
      );
      assert.equal(prof.status, 200);
      assert.equal(prof.body.user.displayName, `Updated ${suffix}`);

      const pCh = await api(
        baseUrl,
        '/api/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: playerPass1,
            newPassword: playerPass2,
            confirmPassword: playerPass2,
          }),
        },
        playerToken
      );
      assert.equal(pCh.status, 200);

      // Admin suspends player -> sessions revoked & login blocked
      const susp = await api(
        baseUrl,
        `/api/admin/players/${playerUserId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) },
        adminToken
      );
      assert.equal(susp.status, 200);

      const afterSuspMe = await api(baseUrl, '/api/auth/me', {}, playerToken);
      assert.equal(afterSuspMe.status, 401);

      // Admin reactivates player -> player logs in with new password
      await api(
        baseUrl,
        `/api/admin/players/${playerUserId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'active' }) },
        adminToken
      );
      const reLogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ method: 'email', email: playerEmail, password: playerPass2 }),
      });
      assert.equal(reLogin.status, 200);
      playerToken = reLogin.body.token;
    });

    // 3. No Demo Faucet + Unconfigured Deposit/Withdrawal Rejection + Auditable Wallet Adjustment
    await t.test('3. No demo faucet, honest unconfigured payments & auditable wallet ledger', async () => {
      const faucet = await api(baseUrl, '/api/wallet/demo-faucet', { method: 'POST' }, playerToken);
      assert.equal(faucet.status, 410);

      const summary = await api(baseUrl, '/api/wallet/summary', {}, playerToken);
      assert.equal(summary.status, 200);
      assert.equal(summary.body.wallet.availableBalance, '0.00');

      // Super Admin credits 100.00 via auditable adjustment
      const adj = await api(
        baseUrl,
        `/api/admin/wallets/${playerUserId}/adjust`,
        {
          method: 'POST',
          body: JSON.stringify({
            direction: 'credit',
            amount: 100,
            reason: 'E2E automated test credit verification',
            idempotencyKey: `e2e-adj-${suffix}`,
          }),
        },
        adminToken
      );
      assert.equal(adj.status, 201);
      assert.equal(adj.body.wallet.availableBalance, '100.00');
    });

    // 4. Real WinGo Round, Bet Placement, Mode Pause/Resume & Ledger Reconciliation
    await t.test('4. Live WinGo betting, mode pause control & zero-discrepancy reconciliation', async () => {
      const state = await api(baseUrl, '/api/game/state/5m');
      assert.equal(state.status, 200);
      assert.ok(state.body.currentRound.periodId);
      assert.ok(state.body.currentRound.serverSeedHash);

      const betRes = await api(
        baseUrl,
        '/api/game/bet',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: '5m',
            periodId: state.body.currentRound.periodId,
            category: 'color',
            selection: 'green',
            unitAmount: 10,
            multiplier: 1,
            idempotencyKey: `e2e-bet1-${suffix}`,
          }),
        },
        playerToken
      );
      assert.equal(betRes.status, 201, `Bet placement failed: ${JSON.stringify(betRes.body)}`);
      assert.equal(betRes.body.wallet.availableBalance, '90.00');

      // Bet shows in Admin Betting Orders and Official Results Exposure
      const orders = await api(baseUrl, '/api/admin/bets?scope=orders&mode=5m', {}, adminToken);
      assert.equal(orders.status, 200);
      assert.ok(orders.body.items.some((b: any) => b.ticketId === betRes.body.bet.ticketId));

      const resultsMonitor = await api(baseUrl, '/api/admin/results?mode=5m', {}, adminToken);
      assert.equal(resultsMonitor.status, 200);
      assert.ok(Array.isArray(resultsMonitor.body.currentExposure));

      // Pause 5m mode -> rejects further bets with 409, then resume
      const pause = await api(
        baseUrl,
        '/api/admin/games/mode-status',
        { method: 'PATCH', body: JSON.stringify({ mode: '5m', paused: true }) },
        adminToken
      );
      assert.equal(pause.status, 200);

      const blockedBet = await api(
        baseUrl,
        '/api/game/bet',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: '5m',
            periodId: state.body.currentRound.periodId,
            category: 'size',
            selection: 'big',
            unitAmount: 10,
            multiplier: 1,
            idempotencyKey: `e2e-bet2-${suffix}`,
          }),
        },
        playerToken
      );
      assert.equal(blockedBet.status, 409);

      await api(
        baseUrl,
        '/api/admin/games/mode-status',
        { method: 'PATCH', body: JSON.stringify({ mode: '5m', paused: false }) },
        adminToken
      );

      // Reconcile ledger across all wallets -> 0 discrepancies
      const rec = await api(baseUrl, '/api/admin/finance/reconcile', {}, adminToken);
      assert.equal(rec.status, 200);
      assert.equal(rec.body.discrepancyCount, 0);
    });

    // 5. Support Ticket, Announcement Sync, Gift Code & All 23 Admin Module Endpoints
    await t.test('5. Support sync, Announcement sync, Gift Code redemption & all 23 Admin APIs', async () => {
      // Support Ticket round-trip
      const ticketRes = await api(
        baseUrl,
        '/api/support/tickets',
        {
          method: 'POST',
          body: JSON.stringify({
            category: 'Account problem',
            subject: `E2E Help ${suffix}`,
            message: 'Checking real support persistence.',
          }),
        },
        playerToken
      );
      assert.equal(ticketRes.status, 201);
      const ticketId = ticketRes.body.ticket.id;

      const reply = await api(
        baseUrl,
        `/api/admin/support/tickets/${ticketId}/reply`,
        { method: 'POST', body: JSON.stringify({ message: 'Admin verified your ticket.', status: 'resolved' }) },
        adminToken
      );
      assert.equal(reply.status, 201);

      const playerTicketDetail = await api(baseUrl, `/api/support/tickets/${ticketId}`, {}, playerToken);
      assert.equal(playerTicketDetail.status, 200);
      assert.equal(playerTicketDetail.body.messages.length, 2);

      // Announcement live sync
      const annText = `E2E Live Announcement ${suffix}`;
      const annCreate = await api(
        baseUrl,
        '/api/admin/announcements',
        { method: 'POST', body: JSON.stringify({ title: 'E2E Notice', content: annText, enabled: true }) },
        adminToken
      );
      assert.equal(annCreate.status, 201);
      createdAnnouncementId = annCreate.body.announcement.id;

      const pubAnn = await api(baseUrl, '/api/public/announcement');
      assert.equal(pubAnn.status, 200);
      assert.equal(pubAnn.body.announcement.text, annText);

      // Gift Code create + redeem
      const giftCodeStr = `E2E${suffix.toUpperCase()}`;
      const gcCreate = await api(
        baseUrl,
        '/api/admin/promotions',
        {
          method: 'POST',
          body: JSON.stringify({
            code: giftCodeStr,
            title: 'E2E Bonus',
            rewardAmount: 15,
            maxRedemptions: 5,
            minDepositRequired: 0,
            expiresInDays: 7,
          }),
        },
        adminToken
      );
      assert.equal(gcCreate.status, 201);
      createdGiftCodeIds.push(gcCreate.body.giftCode.id);

      const redeem = await api(
        baseUrl,
        '/api/gifts/redeem',
        { method: 'POST', body: JSON.stringify({ code: giftCodeStr }) },
        playerToken
      );
      assert.equal(redeem.status, 200);
      assert.equal(redeem.body.wallet.availableBalance, '105.00');

      // Verify remaining Admin module endpoints respond 200 cleanly
      const adminEndpoints = [
        '/api/admin/dashboard',
        '/api/admin/admins',
        '/api/admin/games/overview',
        '/api/admin/rounds',
        '/api/admin/bets?scope=history',
        '/api/admin/wallets',
        '/api/admin/finance/deposits',
        '/api/admin/finance/withdrawals',
        '/api/admin/finance/ledger',
        '/api/admin/agency/overview',
        '/api/admin/referrals',
        '/api/admin/commissions',
        '/api/admin/promotions',
        '/api/admin/campaigns',
        '/api/admin/support/tickets',
        '/api/admin/announcements',
        '/api/admin/reports',
        '/api/admin/system/settings',
        '/api/admin/security/settings',
        '/api/admin/security/sessions',
        '/api/admin/system/audit-logs',
      ];
      for (const ep of adminEndpoints) {
        const res = await api(baseUrl, ep, {}, adminToken);
        assert.equal(res.status, 200, `Admin endpoint ${ep} returned ${res.status}`);
      }
    });
  } finally {
    // Clean up ONLY test-created rows so zero test residue remains in PostgreSQL
    if (createdGiftCodeIds.length) {
      await db.delete(giftRedemptions).where(inArray(giftRedemptions.giftCodeId, createdGiftCodeIds));
      await db.delete(giftCodes).where(inArray(giftCodes.id, createdGiftCodeIds));
    }
    // Restore watched platform_settings keys FIRST (clears updated_by_user_id FK to test admin)
    for (const key of watchedKeys) {
      if (key in originalSettingsBackup) {
        await db
          .insert(platformSettings)
          .values({ key, valueJson: originalSettingsBackup[key], updatedByUserId: null, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { valueJson: originalSettingsBackup[key], updatedByUserId: null, updatedAt: new Date() },
          });
      } else {
        await db.delete(platformSettings).where(eq(platformSettings.key, key));
      }
    }

    if (createdUserIds.length) {
      const userTickets = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(inArray(supportTickets.userId, createdUserIds));
      if (userTickets.length) {
        const tIds = userTickets.map((t) => t.id);
        await db.delete(supportMessages).where(inArray(supportMessages.ticketId, tIds));
        await db.delete(supportTickets).where(inArray(supportTickets.id, tIds));
      }
      await db.delete(bets).where(inArray(bets.userId, createdUserIds));
      await db.delete(ledgerTransactions).where(inArray(ledgerTransactions.userId, createdUserIds));
      await db.delete(depositRequests).where(inArray(depositRequests.userId, createdUserIds));
      await db.delete(withdrawalRequests).where(inArray(withdrawalRequests.userId, createdUserIds));
      await db.delete(bankAccounts).where(inArray(bankAccounts.userId, createdUserIds));
      await db.delete(wallets).where(inArray(wallets.userId, createdUserIds));
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
      await db.delete(auditLogs).where(
        inArray(
          auditLogs.entityId,
          createdUserIds.map((id) => String(id))
        )
      );
      if (createdAnnouncementId) {
        await db.delete(auditLogs).where(eq(auditLogs.entityId, createdAnnouncementId));
      }
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }

    // Confirm test user is gone
    const leftover = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.email, playerEmail));
    assert.equal(leftover[0]?.count, 0);

    server.close();
    server.closeAllConnections?.();
    await pool.end();
  }
});
