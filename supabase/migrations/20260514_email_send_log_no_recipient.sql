-- Codex round-4: previously `no_recipient` rejections returned without
-- writing an audit row, which made budget enforcement leaky (a caller
-- hammering the helper with missing recipient configs would never trip
-- the daily cap). We now write `rejected_no_recipient` rows so those
-- attempts still count. Update the CHECK constraint to allow it.

alter table public.email_send_log
  drop constraint if exists email_send_log_outcome_check;

alter table public.email_send_log
  add constraint email_send_log_outcome_check
  check (
    outcome in (
      'sent',
      'failed',
      'rejected_allowlist',
      'rejected_budget',
      'rejected_no_recipient'
    )
  );
