import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  bankAccounts,
  depositRequests,
  ledgerTransactions,
  platformSettings,
  withdrawalRequests,
} from '../../db/schema.ts';
import {
  createRateLimiter,
  encryptSensitive,
  generateRef,
  maskAccountNumber,
} from '../crypto.ts';
import {
  applyWalletMutationTx,
  ensureWallet,
  recordAuditLog,
} from '../ledger.ts';
import { formatMoney, roundMoney } from '../rules.ts';
import {
  requireAuth,
  requireVerifiedAccount,
  type AuthenticatedRequest,
} from '../auth.ts';
import {
  buildDepositSnapshot,
  listDepositChannels,
  resolveSafeQrFilePath,
} from '../depositChannels.ts';

export const walletRouter = Router();

const financeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, label: 'finance' });

export interface PaymentChannelConfig {
  code: string;
  label: string;
  subtitle: string;
  minAmount: number;
  maxAmount: number;
  bonusRate: number;
  presets: number[];
  enabled: boolean;
  configured: boolean;
  requiresUtr: boolean;
  qrPayloadTemplate: string;
  instructions: string[];
}

export interface WithdrawalRailConfig {
  configured: boolean;
  enabled: boolean;
  minAmount: number;
  maxAmount: number;
  providerLabel: string;
}

// All payment channels default to NOT CONFIGURED and DISABLED until an authorized administrator
// configures real settlement details in Admin Panel -> Platform Settings.
export const DEFAULT_PAYMENT_CHANNELS: PaymentChannelConfig[] = [
  {
    code: 'qr_standard',
    label: 'Instant QR Pay',
    subtitle: 'Not configured',
    minAmount: 10,
    maxAmount: 50000,
    bonusRate: 0,
    presets: [100, 200, 300, 500, 1000, 2000, 3000, 5000],
    enabled: false,
    configured: false,
    requiresUtr: true,
    qrPayloadTemplate: '',
    instructions: [
      'Scan the verified merchant QR code and pay the exact order amount.',
      'Submit your payment reference / UTR for finance verification.',
      'Balances are credited ONLY after authorized payment verification.',
    ],
  },
  {
    code: 'ewallet',
    label: 'E-Wallet Transfer',
    subtitle: 'Not configured',
    minAmount: 10,
    maxAmount: 25000,
    bonusRate: 0,
    presets: [100, 250, 500, 1000, 2500, 5000],
    enabled: false,
    configured: false,
    requiresUtr: true,
    qrPayloadTemplate: '',
    instructions: [
      'Transfer the exact amount via your configured e-wallet provider.',
      'Submit the transfer reference ID for finance reconciliation.',
    ],
  },
  {
    code: 'bank_transfer',
    label: 'Direct Bank Transfer',
    subtitle: 'Not configured',
    minAmount: 50,
    maxAmount: 100000,
    bonusRate: 0,
    presets: [100, 500, 1000, 5000, 10000],
    enabled: false,
    configured: false,
    requiresUtr: true,
    qrPayloadTemplate: '',
    instructions: [
      'Include your exact Order ID in the bank transfer memo.',
      'Finance team verifies settlement before crediting available balance.',
    ],
  },
  {
    code: 'crypto_usdt',
    label: 'USDT (TRC20)',
    subtitle: 'Not configured',
    minAmount: 20,
    maxAmount: 100000,
    bonusRate: 0,
    presets: [20, 50, 100, 500, 1000, 5000],
    enabled: false,
    configured: false,
    requiresUtr: true,
    qrPayloadTemplate: '',
    instructions: [
      'Send only to the administrator-configured settlement wallet address.',
      'Submit the on-chain transaction hash (TxID) for verification.',
    ],
  },
];

export const DEFAULT_WITHDRAWAL_RAIL: WithdrawalRailConfig = {
  configured: false,
  enabled: false,
  minAmount: 10,
  maxAmount: 50000,
  providerLabel: 'Not configured',
};

export async function getPaymentChannels(): Promise<PaymentChannelConfig[]> {
  try {
    const [setting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'payment_channels'))
      .limit(1);

    if (setting && Array.isArray(setting.valueJson)) {
      return (setting.valueJson as Partial<PaymentChannelConfig>[]).map((ch) => ({
        code: String(ch.code || 'custom'),
        label: String(ch.label || 'Payment Channel'),
        subtitle: String(ch.subtitle || (ch.configured ? 'Configured' : 'Not configured')),
        minAmount: Number(ch.minAmount || 10),
        maxAmount: Number(ch.maxAmount || 50000),
        bonusRate: Number(ch.bonusRate || 0),
        presets: Array.isArray(ch.presets) ? ch.presets.map(Number) : [100, 500, 1000],
        enabled: Boolean(ch.enabled) && Boolean(ch.configured),
        configured: Boolean(ch.configured),
        requiresUtr: ch.requiresUtr !== false,
        qrPayloadTemplate: String(ch.qrPayloadTemplate || ''),
        instructions: Array.isArray(ch.instructions) ? ch.instructions.map(String) : [],
      }));
    }
    return DEFAULT_PAYMENT_CHANNELS;
  } catch {
    return DEFAULT_PAYMENT_CHANNELS;
  }
}

export async function getWithdrawalRailConfig(): Promise<WithdrawalRailConfig> {
  try {
    const [setting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'withdrawal_rail'))
      .limit(1);

    if (setting && setting.valueJson && typeof setting.valueJson === 'object') {
      const val = setting.valueJson as Partial<WithdrawalRailConfig>;
      return {
        configured: Boolean(val.configured),
        enabled: Boolean(val.enabled) && Boolean(val.configured),
        minAmount: Number(val.minAmount || 10),
        maxAmount: Number(val.maxAmount || 50000),
        providerLabel: String(val.providerLabel || (val.configured ? 'Configured Bank Payout' : 'Not configured')),
      };
    }
    return DEFAULT_WITHDRAWAL_RAIL;
  } catch {
    return DEFAULT_WITHDRAWAL_RAIL;
  }
}

walletRouter.get('/summary', requireAuth, async (req: AuthenticatedRequest, res) => {
  const typeFilter = String(req.query.type || 'all');
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(5, parseInt(String(req.query.pageSize || '20'), 10) || 20));

  try {
    const wallet = await ensureWallet(req.authUser!.id);
    const conditions = [eq(ledgerTransactions.userId, req.authUser!.id)];
    if (typeFilter !== 'all') {
      conditions.push(eq(ledgerTransactions.type, typeFilter));
    }

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(ledgerTransactions)
      .where(whereClause);

    const transactions = await db
      .select()
      .from(ledgerTransactions)
      .where(whereClause)
      .orderBy(desc(ledgerTransactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return res.json({
      wallet,
      page,
      pageSize,
      total: countRow?.total || 0,
      transactions,
    });
  } catch (error) {
    console.error('Wallet summary error:', error);
    return res.status(500).json({ error: 'Unable to load wallet summary.' });
  }
});

// Demo faucet permanently removed — zero fake credits allowed
walletRouter.post('/demo-faucet', (_req, res) => {
  return res.status(410).json({
    error: 'Demo test funds faucet is permanently disabled. All wallet credits must come from real verified transactions or authorized auditable administrator ledger adjustments.',
  });
});

walletRouter.get('/qr-images/:filename', (req, res) => {
  const resolved = resolveSafeQrFilePath(req.params.filename);
  if (!resolved) {
    return res.status(404).json({ error: 'QR image not found.' });
  }
  res.setHeader('Content-Type', resolved.contentType);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(resolved.filePath);
});

walletRouter.get('/payment-channels', requireAuth, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const [activeChannels, withdrawalRail] = await Promise.all([
    listDepositChannels({ onlyEnabled: true }),
    getWithdrawalRailConfig(),
  ]);
  return res.json({
    depositProviderConfigured: activeChannels.length > 0,
    withdrawalProviderConfigured: withdrawalRail.configured && withdrawalRail.enabled,
    withdrawalRail,
    channels: activeChannels,
  });
});

walletRouter.post(
  '/deposits',
  requireAuth,
  requireVerifiedAccount,
  financeLimiter,
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      channelCode: z.string().min(2).max(60),
      amount: z.number().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Select a valid payment channel and amount.' });
    }

    try {
      const activeChannels = await listDepositChannels({ onlyEnabled: true });
      const channel = activeChannels.find((c) => c.code === parsed.data.channelCode);
      if (!channel) {
        return res.status(400).json({
          error: 'Payment provider is not configured or this deposit channel is currently disabled.',
        });
      }
      if (parsed.data.amount < channel.minAmount || parsed.data.amount > channel.maxAmount) {
        return res.status(400).json({
          error: `Deposit amount must be between ${channel.minAmount} and ${channel.maxAmount}.`,
        });
      }

      const orderRef = generateRef('DEP');
      const bonusAmount = roundMoney(parsed.data.amount * (channel.bonusRate / 100));
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const snapshot = buildDepositSnapshot(channel);

      const [deposit] = await db
        .insert(depositRequests)
        .values({
          orderRef,
          userId: req.authUser!.id,
          channelId: channel.id,
          channelVersion: channel.version,
          channelCode: channel.code,
          channelLabel: channel.name,
          currency: channel.currency,
          amount: formatMoney(parsed.data.amount),
          bonusRate: channel.bonusRate.toFixed(2),
          bonusAmount: formatMoney(bonusAmount),
          instructionsSnapshotJson: snapshot,
          status: 'pending',
          expiresAt,
        })
        .returning();

      let qrPayload = '';
      if (channel.category === 'qr_payment' && 'qrPayload' in channel.details && channel.details.qrPayload) {
        qrPayload = channel.details.qrPayload
          .replace('{ORDER}', orderRef)
          .replace('{AMOUNT}', formatMoney(parsed.data.amount));
      } else if (channel.category === 'usdt_trc20' && 'walletAddress' in channel.details) {
        qrPayload = channel.details.walletAddress;
      }

      const qrDataUrl = qrPayload ? await QRCode.toDataURL(qrPayload, { width: 240, margin: 2 }) : null;

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email || req.authUser!.phone || req.authUser!.username,
        action: 'deposit.created',
        entityType: 'deposit_request',
        entityId: orderRef,
        details: {
          amount: deposit.amount,
          currency: channel.currency,
          channelId: channel.id,
          channelCode: channel.code,
          channelVersion: channel.version,
        },
        ipAddress: req.ip,
      });

      return res.status(201).json({
        deposit,
        channel,
        snapshot,
        qrDataUrl,
        qrPayload,
      });
    } catch (error) {
      console.error('Create deposit error:', error);
      return res.status(500).json({ error: 'Unable to initiate deposit order.' });
    }
  }
);

// Submitting a UTR / reference records it for review and NEVER auto-credits balance
walletRouter.post(
  '/deposits/:id/utr',
  requireAuth,
  financeLimiter,
  async (req: AuthenticatedRequest, res) => {
    const depositId = parseInt(req.params.id, 10);
    const schema = z.object({
      utrReference: z.string().trim().min(6, 'Reference / UTR must be at least 6 characters').max(80),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(depositId) || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? 'Invalid deposit ID.' : parsed.error.issues[0]?.message });
    }

    try {
      const [existing] = await db
        .select()
        .from(depositRequests)
        .where(and(eq(depositRequests.id, depositId), eq(depositRequests.userId, req.authUser!.id)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'Deposit order not found.' });
      }
      if (existing.status !== 'pending' && existing.status !== 'awaiting_verification') {
        return res.status(400).json({ error: `Deposit order is already ${existing.status}.` });
      }
      if (Date.now() > existing.expiresAt.getTime()) {
        await db
          .update(depositRequests)
          .set({ status: 'expired' })
          .where(eq(depositRequests.id, existing.id));
        return res.status(400).json({ error: 'This deposit order has expired. Please create a new order.' });
      }

      const [updated] = await db
        .update(depositRequests)
        .set({
          utrReference: parsed.data.utrReference,
          status: 'awaiting_verification',
        })
        .where(eq(depositRequests.id, existing.id))
        .returning();

      return res.json({
        message: 'Transaction reference submitted for review. Funds will be credited only after payment verification.',
        deposit: updated,
      });
    } catch (error) {
      console.error('Submit UTR error:', error);
      return res.status(500).json({ error: 'Unable to submit transaction reference.' });
    }
  }
);

walletRouter.get('/deposits', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.userId, req.authUser!.id))
      .orderBy(desc(depositRequests.createdAt))
      .limit(50);

    return res.json({ items });
  } catch (error) {
    console.error('Get deposits error:', error);
    return res.status(500).json({ error: 'Unable to load deposit history.' });
  }
});

// Bank Accounts (Country-specific & AES-256-GCM encrypted at rest)
walletRouter.get('/bank-accounts', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await db
      .select({
        id: bankAccounts.id,
        countryCode: bankAccounts.countryCode,
        bankName: bankAccounts.bankName,
        recipientName: bankAccounts.recipientName,
        accountNumberMasked: bankAccounts.accountNumberMasked,
        routingCodeLabel: bankAccounts.routingCodeLabel,
        routingCodeValue: bankAccounts.routingCodeValue,
        phoneNumber: bankAccounts.phoneNumber,
        isDefault: bankAccounts.isDefault,
        createdAt: bankAccounts.createdAt,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, req.authUser!.id))
      .orderBy(desc(bankAccounts.isDefault), desc(bankAccounts.createdAt));

    return res.json({ items });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    return res.status(500).json({ error: 'Unable to load saved bank accounts.' });
  }
});

walletRouter.post(
  '/bank-accounts',
  requireAuth,
  requireVerifiedAccount,
  financeLimiter,
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      countryCode: z.enum(['IN', 'KH', 'US', 'GB', 'SG', 'GLOBAL']).default('IN'),
      bankName: z.string().trim().min(2).max(80),
      recipientName: z.string().trim().min(2).max(80),
      accountNumber: z.string().trim().min(6).max(34),
      routingCodeLabel: z.string().trim().min(2).max(30).default('IFSC'),
      routingCodeValue: z.string().trim().min(3).max(34),
      phoneNumber: z.string().trim().min(6).max(24),
      isDefault: z.boolean().optional().default(true),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid bank account details.' });
    }

    const d = parsed.data;
    try {
      const created = await db.transaction(async (tx) => {
        if (d.isDefault) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false })
            .where(eq(bankAccounts.userId, req.authUser!.id));
        }

        const [row] = await tx
          .insert(bankAccounts)
          .values({
            userId: req.authUser!.id,
            countryCode: d.countryCode,
            bankName: d.bankName,
            recipientName: d.recipientName,
            accountNumberEncrypted: encryptSensitive(d.accountNumber),
            accountNumberMasked: maskAccountNumber(d.accountNumber),
            routingCodeLabel: d.routingCodeLabel,
            routingCodeValue: d.routingCodeValue.toUpperCase(),
            phoneNumber: d.phoneNumber,
            isDefault: d.isDefault,
          })
          .returning({
            id: bankAccounts.id,
            countryCode: bankAccounts.countryCode,
            bankName: bankAccounts.bankName,
            recipientName: bankAccounts.recipientName,
            accountNumberMasked: bankAccounts.accountNumberMasked,
            routingCodeLabel: bankAccounts.routingCodeLabel,
            routingCodeValue: bankAccounts.routingCodeValue,
            phoneNumber: bankAccounts.phoneNumber,
            isDefault: bankAccounts.isDefault,
            createdAt: bankAccounts.createdAt,
          });
        return row;
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email || req.authUser!.phone || req.authUser!.username,
        action: 'bank_account.added',
        entityType: 'bank_account',
        entityId: String(created.id),
        details: { countryCode: created.countryCode, bankName: created.bankName, masked: created.accountNumberMasked },
        ipAddress: req.ip,
      });

      return res.status(201).json({ bankAccount: created });
    } catch (error) {
      console.error('Add bank account error:', error);
      return res.status(500).json({ error: 'Unable to save bank account.' });
    }
  }
);

walletRouter.delete('/bank-accounts/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid bank account ID.' });
  }

  try {
    const activeWithdrawals = await db
      .select({ id: withdrawalRequests.id })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.bankAccountId, id),
          eq(withdrawalRequests.userId, req.authUser!.id),
          eq(withdrawalRequests.status, 'pending')
        )
      )
      .limit(1);

    if (activeWithdrawals.length > 0) {
      return res.status(400).json({ error: 'Cannot remove a bank account with pending withdrawals.' });
    }

    await db
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, req.authUser!.id)));

    return res.json({ message: 'Bank account removed.' });
  } catch (error) {
    console.error('Delete bank account error:', error);
    return res.status(500).json({ error: 'Unable to delete bank account.' });
  }
});

// Withdrawals (requires configured payout rail + atomic balance deduction + admin payout confirmation)
walletRouter.post(
  '/withdrawals',
  requireAuth,
  requireVerifiedAccount,
  financeLimiter,
  async (req: AuthenticatedRequest, res) => {
    const rail = await getWithdrawalRailConfig();
    if (!rail.configured || !rail.enabled) {
      return res.status(400).json({
        error: 'Withdrawal payout provider is not configured. Please contact an administrator.',
      });
    }

    const schema = z.object({
      bankAccountId: z.number().int().positive(),
      amount: z.number().min(rail.minAmount).max(rail.maxAmount),
      idempotencyKey: z.string().min(8).max(96),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          parsed.error.issues[0]?.message ||
          `Withdrawal amount must be between ${rail.minAmount} and ${rail.maxAmount}.`,
      });
    }

    try {
      const [bank] = await db
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, parsed.data.bankAccountId), eq(bankAccounts.userId, req.authUser!.id)))
        .limit(1);

      if (!bank) {
        return res.status(404).json({ error: 'Selected bank account not found.' });
      }

      const result = await db.transaction(async (tx) => {
        const orderRef = generateRef('WDR');
        const { wallet, duplicate } = await applyWalletMutationTx(tx, {
          userId: req.authUser!.id,
          type: 'withdrawal',
          amount: -parsed.data.amount,
          idempotencyKey: `withdraw:${req.authUser!.id}:${parsed.data.idempotencyKey}`,
          sourceType: 'withdrawal_request',
          sourceId: orderRef,
          note: `Withdrawal request to ${bank.bankName} (${bank.accountNumberMasked})`,
          totalsDelta: { withdrawn: parsed.data.amount },
        });

        if (duplicate) {
          const [existing] = await tx
            .select()
            .from(withdrawalRequests)
            .where(eq(withdrawalRequests.userId, req.authUser!.id))
            .orderBy(desc(withdrawalRequests.createdAt))
            .limit(1);
          return { withdrawal: existing, wallet, duplicate: true };
        }

        const [withdrawal] = await tx
          .insert(withdrawalRequests)
          .values({
            orderRef,
            userId: req.authUser!.id,
            bankAccountId: bank.id,
            amount: formatMoney(parsed.data.amount),
            status: 'pending',
          })
          .returning();

        return { withdrawal, wallet, duplicate: false };
      });

      await recordAuditLog({
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email || req.authUser!.phone || req.authUser!.username,
        action: 'withdrawal.requested',
        entityType: 'withdrawal_request',
        entityId: result.withdrawal?.orderRef || 'unknown',
        details: { amount: parsed.data.amount, bankName: bank.bankName },
        ipAddress: req.ip,
      });

      return res.status(result.duplicate ? 200 : 201).json({
        message: 'Withdrawal request submitted for security and finance review.',
        withdrawal: result.withdrawal,
        wallet: result.wallet,
      });
    } catch (error: any) {
      if (error?.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'Insufficient available balance for withdrawal.' });
      }
      console.error('Withdrawal request error:', error);
      return res.status(500).json({ error: 'Unable to create withdrawal request.' });
    }
  }
);

walletRouter.get('/withdrawals', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rows = await db
      .select({
        withdrawal: withdrawalRequests,
        bankName: bankAccounts.bankName,
        accountNumberMasked: bankAccounts.accountNumberMasked,
        recipientName: bankAccounts.recipientName,
      })
      .from(withdrawalRequests)
      .leftJoin(bankAccounts, eq(withdrawalRequests.bankAccountId, bankAccounts.id))
      .where(eq(withdrawalRequests.userId, req.authUser!.id))
      .orderBy(desc(withdrawalRequests.createdAt))
      .limit(50);

    return res.json({
      items: rows.map((r) => ({
        ...r.withdrawal,
        bankName: r.bankName,
        accountNumberMasked: r.accountNumberMasked,
        recipientName: r.recipientName,
      })),
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    return res.status(500).json({ error: 'Unable to load withdrawal history.' });
  }
});
