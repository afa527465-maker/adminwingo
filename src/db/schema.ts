import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  username: text('username'),
  countryCode: text('country_code').notNull().default('+91'),
  phone: text('phone').unique(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('player'), // player | agent | support | finance | admin | super_admin
  status: text('status').notNull().default('active'), // active | pending_approval | pending_verification | rejected | suspended
  isVerified: boolean('is_verified').notNull().default(false),
  verificationCode: text('verification_code'),
  approvedByUserId: integer('approved_by_user_id'),
  approvedAt: timestamp('approved_at'),
  rejectionReason: text('rejection_reason'),
  ageConfirmed: boolean('age_confirmed').notNull().default(false),
  jurisdictionCode: text('jurisdiction_code').notNull().default('IN'),
  inviteCode: text('invite_code').notNull().unique(),
  referredById: integer('referred_by_id'),
  vipLevel: integer('vip_level').notNull().default(0),
  language: text('language').notNull().default('en'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  currency: text('currency').notNull().default('USD'),
  availableBalance: numeric('available_balance', { precision: 18, scale: 2 }).notNull().default('0.00'),
  reservedBalance: numeric('reserved_balance', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalDeposited: numeric('total_deposited', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalWithdrawn: numeric('total_withdrawn', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalWagered: numeric('total_wagered', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalWon: numeric('total_won', { precision: 18, scale: 2 }).notNull().default('0.00'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ledgerTransactions = pgTable('ledger_transactions', {
  id: serial('id').primaryKey(),
  txRef: text('tx_ref').notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull(), // deposit | withdrawal | withdrawal_refund | wager | payout | wager_refund | gift_bonus | commission | admin_adjustment
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }).notNull(),
  status: text('status').notNull().default('completed'),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gameRulesets = pgTable('game_rulesets', {
  id: serial('id').primaryKey(),
  version: text('version').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  ownerApprovedForProd: boolean('owner_approved_for_prod').notNull().default(false),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  configJson: jsonb('config_json').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gameRounds = pgTable('game_rounds', {
  id: serial('id').primaryKey(),
  periodId: text('period_id').notNull().unique(),
  mode: text('mode').notNull(), // 30s | 1m | 3m | 5m
  rulesetVersion: text('ruleset_version').notNull(),
  status: text('status').notNull().default('open'), // open | closed | settled
  startsAt: timestamp('starts_at').notNull(),
  closesAt: timestamp('closes_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  winningNumber: integer('winning_number'),
  winningColors: jsonb('winning_colors'),
  winningSize: text('winning_size'),
  serverSeedHash: text('server_seed_hash').notNull(),
  serverSeedReveal: text('server_seed_reveal'),
  settledAt: timestamp('settled_at'),
  totalWagered: numeric('total_wagered', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalPayout: numeric('total_payout', { precision: 18, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bets = pgTable('bets', {
  id: serial('id').primaryKey(),
  ticketId: text('ticket_id').notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  roundId: integer('round_id')
    .references(() => gameRounds.id, { onDelete: 'cascade' })
    .notNull(),
  periodId: text('period_id').notNull(),
  mode: text('mode').notNull(),
  category: text('category').notNull(), // color | number | size
  selection: text('selection').notNull(), // green | violet | red | 0..9 | big | small
  unitAmount: numeric('unit_amount', { precision: 18, scale: 2 }).notNull(),
  multiplier: integer('multiplier').notNull(),
  totalStake: numeric('total_stake', { precision: 18, scale: 2 }).notNull(),
  feeAmount: numeric('fee_amount', { precision: 18, scale: 2 }).notNull().default('0.00'),
  netStake: numeric('net_stake', { precision: 18, scale: 2 }).notNull(),
  payoutMultiplier: numeric('payout_multiplier', { precision: 8, scale: 2 }).notNull(),
  potentialPayout: numeric('potential_payout', { precision: 18, scale: 2 }).notNull(),
  actualPayout: numeric('actual_payout', { precision: 18, scale: 2 }).notNull().default('0.00'),
  status: text('status').notNull().default('pending'), // pending | won | lost | refunded
  settledAt: timestamp('settled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const depositChannels = pgTable('deposit_channels', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  category: text('category').notNull(), // bank_transfer | qr_payment | payment_url | usdt_trc20
  name: text('name').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  currency: text('currency').notNull().default('USD'),
  minAmount: numeric('min_amount', { precision: 18, scale: 2 }).notNull().default('10.00'),
  maxAmount: numeric('max_amount', { precision: 18, scale: 2 }).notNull().default('50000.00'),
  bonusRate: numeric('bonus_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  presetsJson: jsonb('presets_json').notNull().default([100, 200, 500, 1000, 5000]),
  instructionsJson: jsonb('instructions_json').notNull().default([]),
  detailsJson: jsonb('details_json').notNull().default({}),
  enabled: boolean('enabled').notNull().default(false),
  version: integer('version').notNull().default(1),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const depositRequests = pgTable('deposit_requests', {
  id: serial('id').primaryKey(),
  orderRef: text('order_ref').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  channelId: integer('channel_id').references(() => depositChannels.id),
  channelVersion: integer('channel_version').notNull().default(1),
  channelCode: text('channel_code').notNull(),
  channelLabel: text('channel_label').notNull(),
  currency: text('currency').notNull().default('USD'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  bonusRate: numeric('bonus_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  bonusAmount: numeric('bonus_amount', { precision: 18, scale: 2 }).notNull().default('0.00'),
  utrReference: text('utr_reference'),
  instructionsSnapshotJson: jsonb('instructions_snapshot_json'),
  status: text('status').notNull().default('pending'), // pending | awaiting_verification | completed | rejected | expired | refunded
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewNote: text('review_note'),
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  countryCode: text('country_code').notNull().default('IN'),
  bankName: text('bank_name').notNull(),
  recipientName: text('recipient_name').notNull(),
  accountNumberEncrypted: text('account_number_encrypted').notNull(),
  accountNumberMasked: text('account_number_masked').notNull(),
  routingCodeLabel: text('routing_code_label').notNull().default('IFSC'),
  routingCodeValue: text('routing_code_value').notNull(),
  phoneNumber: text('phone_number').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const withdrawalRequests = pgTable('withdrawal_requests', {
  id: serial('id').primaryKey(),
  orderRef: text('order_ref').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  bankAccountId: integer('bank_account_id')
    .references(() => bankAccounts.id)
    .notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  status: text('status').notNull().default('pending'), // pending | approved | completed | rejected
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewNote: text('review_note'),
  payoutReference: text('payout_reference'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const commissions = pgTable('commissions', {
  id: serial('id').primaryKey(),
  agentUserId: integer('agent_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  sourceUserId: integer('source_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tier: integer('tier').notNull(), // 1 = direct, 2 = team
  sourceType: text('source_type').notNull(), // wager | deposit
  sourceRef: text('source_ref').notNull().unique(),
  baseAmount: numeric('base_amount', { precision: 18, scale: 2 }).notNull(),
  ratePercent: numeric('rate_percent', { precision: 6, scale: 3 }).notNull(),
  commissionAmount: numeric('commission_amount', { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const giftCodes = pgTable('gift_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  rewardAmount: numeric('reward_amount', { precision: 18, scale: 2 }).notNull(),
  rewardType: text('reward_type').notNull().default('cash'), // cash | coupon
  maxRedemptions: integer('max_redemptions').notNull().default(100),
  currentRedemptions: integer('current_redemptions').notNull().default(0),
  minDepositRequired: numeric('min_deposit_required', { precision: 18, scale: 2 }).notNull().default('0.00'),
  isActive: boolean('is_active').notNull().default(true),
  startsAt: timestamp('starts_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const giftRedemptions = pgTable(
  'gift_redemptions',
  {
    id: serial('id').primaryKey(),
    giftCodeId: integer('gift_code_id')
      .references(() => giftCodes.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    rewardAmount: numeric('reward_amount', { precision: 18, scale: 2 }).notNull(),
    txRef: text('tx_ref').notNull(),
    redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('gift_redemptions_code_user_uidx').on(table.giftCodeId, table.userId)]
);

export const supportTickets = pgTable('support_tickets', {
  id: serial('id').primaryKey(),
  ticketRef: text('ticket_ref').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  category: text('category').notNull(),
  subject: text('subject').notNull(),
  priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
  status: text('status').notNull().default('open'), // open | in_progress | resolved | closed
  assignedAdminId: integer('assigned_admin_id').references(() => users.id),
  internalNotes: text('internal_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supportMessages = pgTable('support_messages', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id')
    .references(() => supportTickets.id, { onDelete: 'cascade' })
    .notNull(),
  senderUserId: integer('sender_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  senderRole: text('sender_role').notNull(), // player | admin
  message: text('message').notNull(),
  attachmentDataUrl: text('attachment_data_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actor_user_id').references(() => users.id),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  detailsJson: jsonb('details_json'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const platformSettings = pgTable('platform_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  valueJson: jsonb('value_json').notNull(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  wallet: one(wallets, { fields: [users.id], references: [wallets.userId] }),
  bets: many(bets),
  deposits: many(depositRequests),
  withdrawals: many(withdrawalRequests),
  bankAccounts: many(bankAccounts),
  supportTickets: many(supportTickets),
}));
