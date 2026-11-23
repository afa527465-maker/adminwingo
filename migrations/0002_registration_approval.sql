-- Add administrator approval tracking columns to users (safe additive migration; preserves all existing data)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
