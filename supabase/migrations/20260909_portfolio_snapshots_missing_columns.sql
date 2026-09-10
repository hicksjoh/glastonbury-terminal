-- ----------------------------------------------------------------------------
-- Repair prod drift on public.portfolio_snapshots.
--
-- 001_create_tables.sql declares this table with CREATE TABLE IF NOT EXISTS.
-- Prod's copy was created from an earlier revision, so when the newer columns
-- were added to 001 the guard matched an already-existing table and silently
-- skipped them. The migration "ran" and reported success while three columns
-- were never created:
--
--     equity, net_worth, positions_json
--
-- Live symptom: GET /api/portfolio/snapshot returned
--   500 {"details":"column portfolio_snapshots.equity does not exist"}
-- on every call, which also broke the Vercel cron at "0 22 * * 1-5". The table
-- currently holds 0 rows — no daily wealth snapshot has ever been written.
--
-- Postgres reports only the FIRST missing column, so fixing `equity` alone
-- would have surfaced `net_worth`, then `positions_json`. All three are added
-- here together. Verified against prod one column at a time before writing.
--
-- Additive and idempotent: no drops, no type changes, no backfill. Types match
-- 001_create_tables.sql exactly.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.portfolio_snapshots
  ADD COLUMN IF NOT EXISTS equity         decimal,
  ADD COLUMN IF NOT EXISTS net_worth      decimal,
  ADD COLUMN IF NOT EXISTS positions_json jsonb;

COMMIT;
