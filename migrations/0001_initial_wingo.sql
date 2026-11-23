-- WinGo Platform — Initial PostgreSQL Schema Migration (Idempotent)
-- Contains ZERO hardcoded passwords, ZERO demo users, and ZERO fake financial records.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,
  country_code TEXT NOT NULL DEFAULT '+91',
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'active',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_code TEXT,
  age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  jurisdiction_code TEXT NOT NULL DEFAULT 'IN',
  invite_code TEXT NOT NULL UNIQUE,
  referred_by_id INTEGER,
  vip_level INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_level INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'USD',
  available_balance NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  reserved_balance NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  total_deposited NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  total_withdrawn NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  total_wagered NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  total_won NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id SERIAL PRIMARY KEY,
  tx_ref TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_rulesets (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  owner_approved_for_prod BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by_user_id INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  config_json JSONB NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_rounds (
  id SERIAL PRIMARY KEY,
  period_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  starts_at TIMESTAMP NOT NULL,
  closes_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  winning_number INTEGER,
  winning_colors JSONB,
  winning_size TEXT,
  server_seed_hash TEXT NOT NULL,
  server_seed_reveal TEXT,
  settled_at TIMESTAMP,
  total_wagered NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  total_payout NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bets (
  id SERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  category TEXT NOT NULL,
  selection TEXT NOT NULL,
  unit_amount NUMERIC(18, 2) NOT NULL,
  multiplier INTEGER NOT NULL,
  total_stake NUMERIC(18, 2) NOT NULL,
  fee_amount NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  net_stake NUMERIC(18, 2) NOT NULL,
  payout_multiplier NUMERIC(8, 2) NOT NULL,
  potential_payout NUMERIC(18, 2) NOT NULL,
  actual_payout NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id SERIAL PRIMARY KEY,
  order_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL,
  channel_label TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  bonus_rate NUMERIC(5, 2) NOT NULL DEFAULT '0.00',
  bonus_amount NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  utr_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id INTEGER REFERENCES users(id),
  review_note TEXT,
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL DEFAULT 'IN',
  bank_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  routing_code_label TEXT NOT NULL DEFAULT 'IFSC',
  routing_code_value TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id SERIAL PRIMARY KEY,
  order_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  amount NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id INTEGER REFERENCES users(id),
  review_note TEXT,
  payout_reference TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commissions (
  id SERIAL PRIMARY KEY,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL UNIQUE,
  base_amount NUMERIC(18, 2) NOT NULL,
  rate_percent NUMERIC(6, 3) NOT NULL,
  commission_amount NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  reward_amount NUMERIC(18, 2) NOT NULL,
  reward_type TEXT NOT NULL DEFAULT 'cash',
  max_redemptions INTEGER NOT NULL DEFAULT 100,
  current_redemptions INTEGER NOT NULL DEFAULT 0,
  min_deposit_required NUMERIC(18, 2) NOT NULL DEFAULT '0.00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_redemptions (
  id SERIAL PRIMARY KEY,
  gift_code_id INTEGER NOT NULL REFERENCES gift_codes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_amount NUMERIC(18, 2) NOT NULL,
  tx_ref TEXT NOT NULL,
  redeemed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS gift_redemptions_code_user_uidx
  ON gift_redemptions (gift_code_id, user_id);

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  ticket_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_admin_id INTEGER REFERENCES users(id),
  internal_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  attachment_data_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json JSONB,
  ip_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value_json JSONB NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
