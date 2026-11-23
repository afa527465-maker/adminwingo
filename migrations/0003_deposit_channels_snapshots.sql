-- Additive migration for admin-controlled deposit payment channels and order snapshots
CREATE TABLE IF NOT EXISTS deposit_channels (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  min_amount NUMERIC(18, 2) NOT NULL DEFAULT 10.00,
  max_amount NUMERIC(18, 2) NOT NULL DEFAULT 50000.00,
  bonus_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  presets_json JSONB NOT NULL DEFAULT '[100,200,500,1000,5000]'::jsonb,
  instructions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES deposit_channels(id),
  ADD COLUMN IF NOT EXISTS channel_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS instructions_snapshot_json JSONB;
