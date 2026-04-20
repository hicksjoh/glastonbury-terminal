-- ============================================================================
-- 20260416_security_hardening.sql
-- ----------------------------------------------------------------------------
-- Fixes Supabase Security Advisor findings on project vmpxcauwzsswxqhglgdv:
--   - 24 ERRORS (RLS Disabled In Public)
--   - 8  WARNINGS (RLS Policy Always True)
--
-- Strategy:
--   1. Drop every permissive "USING (true) / WITH CHECK (true)" policy on
--      the 32 affected tables.
--   2. Enable RLS on every affected table.
--   3. Auto-detect user-ownership column (user_id > owner_id > auth_user_id
--      > created_by) at runtime via information_schema.columns.
--      - If found  -> per-user policies for SELECT/INSERT/UPDATE/DELETE
--                     (auth.uid() = <col>)
--      - If absent -> table is treated as reference data: authenticated
--                     users get SELECT; service_role bypasses RLS for writes.
--   4. Verification block confirms RLS on every target table and that no
--      remaining policy is blanket-permissive for write operations.
--
-- Idempotent. Safe to re-run. No data is dropped.
--
-- Tables addressed (32 total):
--   RLS DISABLED errors (24):
--     agent_actions, autopilot_executions, cashflow_items, congress_trades,
--     crew_sessions, earnings_tone, gex_events, keisha_chat_sessions,
--     keisha_conversations, keisha_recommendations, macro_regime_history,
--     market_regime, monte_carlo_results, monte_carlo_scenarios,
--     notifications, pairs_trades, signal_calibration, tax_events,
--     territories, trade_journal, trade_replays, user_settings, watchlists,
--     wealth_assets
--
--   RLS POLICY ALWAYS TRUE warnings (8):
--     audit_log, keisha_memory_pins, portfolio_snapshots, push_subscriptions,
--     roadmap_entries, strategies, trades, watchlist
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: Drop all blanket-permissive policies on the 32 affected tables.
-- Catches USING (true), WITH CHECK (true), and the parenthesised variants.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  affected CONSTANT text[] := ARRAY[
    -- RLS disabled (errors)
    'agent_actions','autopilot_executions','cashflow_items','congress_trades',
    'crew_sessions','earnings_tone','gex_events','keisha_chat_sessions',
    'keisha_conversations','keisha_recommendations','macro_regime_history',
    'market_regime','monte_carlo_results','monte_carlo_scenarios',
    'notifications','pairs_trades','signal_calibration','tax_events',
    'territories','trade_journal','trade_replays','user_settings','watchlists',
    'wealth_assets',
    -- RLS policy always true (warnings)
    'audit_log','keisha_memory_pins','portfolio_snapshots','push_subscriptions',
    'roadmap_entries','strategies','trades','watchlist'
  ];
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(affected)
      AND (
        COALESCE(qual, 'true')       IN ('true','(true)')
        OR COALESCE(with_check,'true') IN ('true','(true)')
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    RAISE NOTICE 'DROPPED permissive policy % on %.%',
      r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 2: User-owned tables.
-- Auto-detects ownership column. If absent, table is treated as reference
-- data (authenticated SELECT only; service_role writes via bypass).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  user_col text;
  user_owned CONSTANT text[] := ARRAY[
    'agent_actions','autopilot_executions','cashflow_items','crew_sessions',
    'keisha_chat_sessions','keisha_conversations','keisha_recommendations',
    'monte_carlo_results','monte_carlo_scenarios','notifications','pairs_trades',
    'tax_events','trade_journal','trade_replays','user_settings','watchlists',
    'wealth_assets','territories',
    'audit_log','keisha_memory_pins','portfolio_snapshots','push_subscriptions',
    'roadmap_entries','strategies','trades','watchlist'
  ];
BEGIN
  FOREACH t IN ARRAY user_owned LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'SKIP (table missing): public.%', t;
      CONTINUE;
    END IF;

    -- Enable RLS (idempotent).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Pick the best-ranking ownership column if present.
    SELECT column_name INTO user_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = t
      AND column_name IN ('user_id','owner_id','auth_user_id','created_by')
    ORDER BY CASE column_name
      WHEN 'user_id'       THEN 1
      WHEN 'owner_id'      THEN 2
      WHEN 'auth_user_id'  THEN 3
      WHEN 'created_by'    THEN 4
    END
    LIMIT 1;

    IF user_col IS NOT NULL THEN
      -- SELECT
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        t || '_select_own', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
        'USING (auth.uid() = %I)',
        t || '_select_own', t, user_col);

      -- INSERT
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        t || '_insert_own', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
        'WITH CHECK (auth.uid() = %I)',
        t || '_insert_own', t, user_col);

      -- UPDATE
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        t || '_update_own', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
        'USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
        t || '_update_own', t, user_col, user_col);

      -- DELETE
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        t || '_delete_own', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
        'USING (auth.uid() = %I)',
        t || '_delete_own', t, user_col);

      RAISE NOTICE 'USER-OWNED: public.%  (ownership col = %)', t, user_col;
    ELSE
      -- Fallback: no user column found. Treat as backend-managed.
      -- service_role bypasses RLS automatically. Authenticated users get
      -- read-only visibility (change to false if even reads should be
      -- blocked). No INSERT/UPDATE/DELETE policy = denied for non-service.
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        t || '_auth_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
        'USING (true)',
        t || '_auth_read', t);

      RAISE NOTICE 'NO OWNERSHIP COL (service-write, auth-read): public.%', t;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 3: Global reference / market-data tables.
-- authenticated can SELECT; service_role bypasses RLS for ingests.
-- If any of these actually has a user column, STEP 2 would have caught it
-- first (they aren't in that list), but we re-check here for safety.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  has_user boolean;
  reference_tables CONSTANT text[] := ARRAY[
    'congress_trades','earnings_tone','gex_events','macro_regime_history',
    'market_regime','signal_calibration'
  ];
BEGIN
  FOREACH t IN ARRAY reference_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'SKIP (table missing): public.%', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Safety: if this "reference" table actually has a user column, warn
    -- loudly so we can reclassify it next migration.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t
        AND column_name IN ('user_id','owner_id','auth_user_id','created_by')
    ) INTO has_user;

    IF has_user THEN
      RAISE WARNING 'RECLASSIFY: % has a user column but is listed as '
                    'reference. Review classification.', t;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      t || '_read_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (true)',
      t || '_read_all', t);

    RAISE NOTICE 'REFERENCE: public.%', t;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- Run these after the migration commits. Both should look right.
-- ============================================================================

-- A) Every target table should report rls_enabled = true.
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'agent_actions','autopilot_executions','cashflow_items','congress_trades',
    'crew_sessions','earnings_tone','gex_events','keisha_chat_sessions',
    'keisha_conversations','keisha_recommendations','macro_regime_history',
    'market_regime','monte_carlo_results','monte_carlo_scenarios',
    'notifications','pairs_trades','signal_calibration','tax_events',
    'territories','trade_journal','trade_replays','user_settings','watchlists',
    'wealth_assets','audit_log','keisha_memory_pins','portfolio_snapshots',
    'push_subscriptions','roadmap_entries','strategies','trades','watchlist'
  )
ORDER BY tablename;

-- B) No write-path policy on a user-owned table should be blanket-permissive.
--    Reference tables legitimately have SELECT USING (true), so we exclude
--    SELECT-only policies whose qual is true from the failure list.
SELECT
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'agent_actions','autopilot_executions','cashflow_items','crew_sessions',
    'keisha_chat_sessions','keisha_conversations','keisha_recommendations',
    'monte_carlo_results','monte_carlo_scenarios','notifications','pairs_trades',
    'tax_events','trade_journal','trade_replays','user_settings','watchlists',
    'wealth_assets','territories','audit_log','keisha_memory_pins',
    'portfolio_snapshots','push_subscriptions','roadmap_entries','strategies',
    'trades','watchlist'
  )
  AND (
    COALESCE(with_check,'') IN ('true','(true)')
    OR (cmd <> 'SELECT' AND COALESCE(qual,'') IN ('true','(true)'))
  )
ORDER BY tablename, policyname;
-- Expect ZERO ROWS. Any row here = an auth.uid() guard is missing.

-- C) Per-table policy roll-up (confirms the expected 4 user-owned policies
--    per user-owned table and 1 read_all on reference tables).
SELECT tablename, cmd, count(*) AS policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'agent_actions','autopilot_executions','cashflow_items','congress_trades',
    'crew_sessions','earnings_tone','gex_events','keisha_chat_sessions',
    'keisha_conversations','keisha_recommendations','macro_regime_history',
    'market_regime','monte_carlo_results','monte_carlo_scenarios',
    'notifications','pairs_trades','signal_calibration','tax_events',
    'territories','trade_journal','trade_replays','user_settings','watchlists',
    'wealth_assets','audit_log','keisha_memory_pins','portfolio_snapshots',
    'push_subscriptions','roadmap_entries','strategies','trades','watchlist'
  )
GROUP BY tablename, cmd
ORDER BY tablename, cmd;
