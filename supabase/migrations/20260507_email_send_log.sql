-- ============================================================================
-- 20260507_email_send_log.sql
-- ----------------------------------------------------------------------------
-- Codex audit finding (p6-7): src/lib/resend-client.ts accepts caller-
-- supplied `to` with no allowlist or budget. A future exposed route or a
-- compromised cron secret could turn the terminal into an arbitrary email
-- gateway. Two defenses:
--
--   1. Allowlist (env-driven, in lib): reject recipients outside known
--      domains.
--   2. Daily send budget: count rows in `email_send_log` for today (ET)
--      and reject if over the budget.
--
-- This migration adds the log table. Each successful AND failed send is
-- recorded so the budget reflects actual API attempts (rejected sends
-- still count, since a hostile loop could keep hitting Resend even when
-- it 4xx's us).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id            bigserial    PRIMARY KEY,
  sent_at       timestamptz  NOT NULL DEFAULT NOW(),
  to_addr       text         NOT NULL,
  subject       text         NOT NULL,
  outcome       text         NOT NULL CHECK (outcome IN ('sent', 'failed', 'rejected_allowlist', 'rejected_budget')),
  resend_id     text,
  error         text
);

CREATE INDEX IF NOT EXISTS email_send_log_sent_at_idx
  ON public.email_send_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS email_send_log_to_addr_idx
  ON public.email_send_log (to_addr, sent_at DESC);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON public.email_send_log;
CREATE POLICY service_role_full_access ON public.email_send_log
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
