-- ============================================================================
-- 20260417_fix_match_doc_chunks_probes.sql
-- ----------------------------------------------------------------------------
-- Fix: match_doc_chunks returned 0 rows when the doc_chunks table had fewer
-- rows than the ivfflat index's `lists=100` parameter. The default
-- `ivfflat.probes=1` only searches one cluster, and with ~13 rows most
-- clusters were empty — every query landed in an empty one.
--
-- Set `ivfflat.probes = 100` inside the function (full scan equivalent when
-- lists=100; auto-tunes gracefully as the corpus grows past ~10K rows).
-- Idempotent via CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_doc_chunks(
  query_embedding vector(1024),
  match_count     int DEFAULT 20,
  filter_ticker   text DEFAULT NULL,
  filter_doc_type text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  doc_type    doc_chunk_type,
  ticker      text,
  source_url  text,
  source_id   text,
  chunk_text  text,
  chunk_index integer,
  metadata    jsonb,
  similarity  float
)
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM set_config('ivfflat.probes', '100', true);
  RETURN QUERY
  SELECT
    dc.id, dc.doc_type, dc.ticker, dc.source_url, dc.source_id,
    dc.chunk_text, dc.chunk_index, dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.doc_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND (filter_ticker   IS NULL OR dc.ticker   = filter_ticker)
    AND (filter_doc_type IS NULL OR dc.doc_type::text = filter_doc_type)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$fn$;
