-- ============================================================================
-- 20260420_earnings_chunks_unique_seq_and_rpc.sql
-- ----------------------------------------------------------------------------
-- Adversarial QA finding (HIGH): concurrent /ingest calls produced multiple
-- rows at the same `seq` because insertChunks() did read-max-then-increment
-- in app code — a classic TOCTOU race.
--
-- Defense in depth:
--   (a) UNIQUE(session_id, seq) constraint — second writer to land on a
--       collided seq fails fast instead of silently corrupting ordering.
--   (b) public.append_earnings_chunks(session_id, chunks_json) RPC that takes
--       a pg_advisory_xact_lock keyed by session_id, computes max(seq)+1,
--       and inserts atomically. Only ONE writer holds the lock at a time per
--       session, so the read+write is serialized.
--
-- Backfills any existing duplicate seqs by renumbering via row_number()
-- ordered by created_at, then id.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- (a) Renumber existing dupes, then UNIQUE constraint
WITH renumbered AS (
  SELECT id,
         (row_number() OVER (PARTITION BY session_id ORDER BY created_at, id)) - 1 AS new_seq
  FROM public.earnings_transcript_chunks
)
UPDATE public.earnings_transcript_chunks etc
SET seq = r.new_seq
FROM renumbered r
WHERE etc.id = r.id AND etc.seq != r.new_seq;

DO $$ BEGIN
  ALTER TABLE public.earnings_transcript_chunks
    DROP CONSTRAINT IF EXISTS earnings_transcript_chunks_session_seq_unique;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

ALTER TABLE public.earnings_transcript_chunks
  ADD CONSTRAINT earnings_transcript_chunks_session_seq_unique
  UNIQUE (session_id, seq);

-- (b) Atomic RPC
CREATE OR REPLACE FUNCTION public.append_earnings_chunks(
  p_session_id uuid,
  p_chunks jsonb
) RETURNS int
LANGUAGE plpgsql
AS $fn$
DECLARE
  base_seq int;
  inserted int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text));

  SELECT COALESCE(MAX(seq), -1) + 1 INTO base_seq
  FROM public.earnings_transcript_chunks
  WHERE session_id = p_session_id;

  WITH numbered AS (
    SELECT
      (base_seq + (row_number() OVER ()) - 1)::int AS seq,
      NULLIF(c->>'speaker', '') AS speaker,
      c->>'text' AS chunk_text
    FROM jsonb_array_elements(p_chunks) AS c
  )
  INSERT INTO public.earnings_transcript_chunks (session_id, seq, speaker, chunk_text)
  SELECT p_session_id, seq, speaker, chunk_text FROM numbered
  WHERE chunk_text IS NOT NULL AND length(chunk_text) > 0;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$fn$;
