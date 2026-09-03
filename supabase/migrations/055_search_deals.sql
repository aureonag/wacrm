-- ============================================================
-- 055_search_deals.sql — cross-pipeline deal search RPC
--
-- Backs the Pipelines page's global "search deals" (Ctrl+K) box.
-- A single deal can only be usefully searched by joining several
-- tables (contact, tags, assignee, custom field values) — doing
-- that as several client-side `.or()`/`.in()` calls can't rank
-- matches or return one clean "did we match, and where" result,
-- so this follows the same RPC precedent as
-- `filter_contacts_by_tags` (migration 025): one function does the
-- join, ranking, and windowed total count in a single round trip.
--
-- Security: SECURITY INVOKER (the default) — runs as the caller,
-- so the existing RLS on every joined table (account membership)
-- scopes the result to the caller's account. No privilege bypass.
--
-- unaccent lets "sao jose" match "São José" per the product spec.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.search_deals(
  p_search TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  deal_id UUID,
  title TEXT,
  pipeline_id UUID,
  pipeline_name TEXT,
  stage_id UUID,
  stage_name TEXT,
  contact_name TEXT,
  contact_company TEXT,
  assignee_name TEXT,
  matched_snippet TEXT,
  rank INT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH params AS (
    SELECT extensions.unaccent(lower(trim(p_search))) AS term
  ),
  matched AS (
    SELECT
      d.id AS deal_id,
      d.title,
      d.pipeline_id,
      p.name AS pipeline_name,
      d.stage_id,
      s.name AS stage_name,
      c.name AS contact_name,
      c.company AS contact_company,
      pr.full_name AS assignee_name,
      CASE
        WHEN extensions.unaccent(lower(d.title)) = params.term THEN 1
        WHEN extensions.unaccent(lower(d.title)) LIKE params.term || '%' THEN 2
        WHEN extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%' THEN 3
        WHEN extensions.unaccent(lower(coalesce(c.name, ''))) LIKE '%' || params.term || '%'
          OR extensions.unaccent(lower(coalesce(c.company, ''))) LIKE '%' || params.term || '%' THEN 4
        ELSE 5
      END AS rank,
      CASE
        WHEN extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%' THEN NULL
        WHEN extensions.unaccent(lower(coalesce(d.notes, ''))) LIKE '%' || params.term || '%' THEN left(d.notes, 140)
        WHEN EXISTS (
          SELECT 1 FROM deal_custom_values dv
          WHERE dv.deal_id = d.id
            AND extensions.unaccent(lower(coalesce(dv.value, ''))) LIKE '%' || params.term || '%'
        ) THEN (
          SELECT left(dv.value, 140) FROM deal_custom_values dv
          WHERE dv.deal_id = d.id
            AND extensions.unaccent(lower(coalesce(dv.value, ''))) LIKE '%' || params.term || '%'
          LIMIT 1
        )
        ELSE NULL
      END AS matched_snippet
    FROM deals d
    CROSS JOIN params
    JOIN pipelines p ON p.id = d.pipeline_id
    JOIN pipeline_stages s ON s.id = d.stage_id
    LEFT JOIN contacts c ON c.id = d.contact_id
    LEFT JOIN profiles pr ON pr.id = d.assigned_to
    WHERE params.term <> ''
      AND (
        extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.name, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.company, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.phone, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.email, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(d.notes, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(pr.full_name, ''))) LIKE '%' || params.term || '%'
        OR EXISTS (
          SELECT 1 FROM deal_tags dt
          WHERE dt.deal_id = d.id
            AND extensions.unaccent(lower(dt.label)) LIKE '%' || params.term || '%'
        )
        OR EXISTS (
          SELECT 1 FROM deal_custom_values dv
          WHERE dv.deal_id = d.id
            AND extensions.unaccent(lower(coalesce(dv.value, ''))) LIKE '%' || params.term || '%'
        )
      )
  ),
  ranked AS (
    SELECT *, count(*) OVER() AS total_count
    FROM matched
    ORDER BY rank ASC, title ASC
    LIMIT p_limit
  )
  SELECT deal_id, title, pipeline_id, pipeline_name, stage_id, stage_name,
         contact_name, contact_company, assignee_name, matched_snippet, rank, total_count
  FROM ranked;
$$;

ALTER FUNCTION public.search_deals(TEXT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_deals(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_deals(TEXT, INT) TO authenticated;
