-- ============================================================
-- 123_search_deals_phone.sql — a busca de negocios acha pelo telefone
--
-- search_deals (055) ja olhava contacts.phone, mas como TEXTO literal: quase todos
-- os telefones estao guardados formatados ("(11) 95166-7706", "+55 11 95166-7706"),
-- entao digitar so os numeros, ou o numero do WhatsApp com outro formato, nao achava
-- nada. Agora, quando a busca parece um telefone (so digitos e simbolos de telefone,
-- com 4+ digitos), compara so os DIGITOS:
--   - os digitos digitados aparecem no telefone do contato (com ou sem DDI/DDD), ou
--   - os 8 ultimos digitos conferem (cobre "55" a mais/a menos e o 9o digito).
-- O resultado mostra "Telefone: <numero do contato>" na linha do trecho. Negocios
-- abertos aparecem antes dos ganhos/perdidos no mesmo nivel de relevancia.
-- Mesma assinatura da funcao (CREATE OR REPLACE), as permissoes continuam.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_deals(p_search text, p_limit integer DEFAULT 10)
 RETURNS TABLE(deal_id uuid, title text, pipeline_id uuid, pipeline_name text, stage_id uuid, stage_name text, contact_name text, contact_company text, assignee_name text, matched_snippet text, rank integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH params AS (
    SELECT
      extensions.unaccent(lower(trim(p_search))) AS term,
      regexp_replace(coalesce(p_search, ''), '\D', '', 'g') AS digits,
      (
        trim(coalesce(p_search, '')) ~ '^[+()\s.\-0-9]+$'
        AND length(regexp_replace(coalesce(p_search, ''), '\D', '', 'g')) >= 4
      ) AS is_phone
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
      (d.status <> 'open') AS closed,
      CASE
        WHEN extensions.unaccent(lower(d.title)) = params.term THEN 1
        WHEN ph.hit THEN 2
        WHEN extensions.unaccent(lower(d.title)) LIKE params.term || '%' THEN 2
        WHEN extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%' THEN 3
        WHEN extensions.unaccent(lower(coalesce(c.name, ''))) LIKE '%' || params.term || '%'
          OR extensions.unaccent(lower(coalesce(c.company, ''))) LIKE '%' || params.term || '%' THEN 4
        ELSE 5
      END AS rank,
      CASE
        WHEN extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%' THEN NULL
        WHEN ph.hit THEN 'Telefone: ' || c.phone
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
    -- Phone by digits only: formatting, DDI and the 9th digit do not matter.
    CROSS JOIN LATERAL (
      SELECT (
        params.is_phone
        AND c.id IS NOT NULL
        AND (
          regexp_replace(coalesce(nullif(c.phone_normalized, ''), c.phone, ''), '\D', '', 'g') LIKE '%' || params.digits || '%'
          OR (
            length(params.digits) >= 8
            AND right(regexp_replace(coalesce(nullif(c.phone_normalized, ''), c.phone, ''), '\D', '', 'g'), 8) = right(params.digits, 8)
          )
        )
      ) AS hit
    ) ph
    WHERE params.term <> ''
      AND (
        extensions.unaccent(lower(d.title)) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.name, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.company, ''))) LIKE '%' || params.term || '%'
        OR extensions.unaccent(lower(coalesce(c.phone, ''))) LIKE '%' || params.term || '%'
        OR ph.hit
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
    ORDER BY rank ASC, closed ASC, title ASC
    LIMIT p_limit
  )
  SELECT deal_id, title, pipeline_id, pipeline_name, stage_id, stage_name,
         contact_name, contact_company, assignee_name, matched_snippet, rank, total_count
  FROM ranked;
$function$;
