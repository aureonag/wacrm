-- Reportei / Meta: janelas de atribuicao pedidas por vinculo (conta de anuncios de um cliente).
--
-- BANCO DE DESTINO: producao (projeto Supabase heesqqbjssficymgkdme, "wacrm"), o unico
-- banco do projeto; o servidor local tambem aponta para ele.
-- STATUS: PREPARADA, NAO APLICADA. Aplicar so com autorizacao especifica.
--
-- IMPACTO
--   ad_integrations ganha uma coluna nova, NULL por padrao (= a atribuicao que a Meta aplica
--   por padrao, como hoje). Nenhuma linha e apagada ou reescrita; nenhum numero muda ate
--   alguem escolher janelas para um vinculo. O codigo ja funciona sem a coluna (le com a
--   atribuicao padrao da Meta); com ela, a tela de Integracoes passa a permitir escolher.
--   Valores aceitos: 1d_click, 7d_click, 28d_click, 1d_view, 7d_view, 28d_view, 1d_ev_view,
--   de 1 a 4 itens, sem repeticao de significado checada aqui (a Meta valida as combinacoes).
--
-- RECUPERACAO (desfazer)
--   ALTER TABLE ad_integrations DROP COLUMN IF EXISTS attribution_windows;

ALTER TABLE ad_integrations
  ADD COLUMN IF NOT EXISTS attribution_windows text[]
  CHECK (
    attribution_windows IS NULL
    OR (
      cardinality(attribution_windows) BETWEEN 1 AND 4
      AND attribution_windows <@ ARRAY['1d_click', '7d_click', '28d_click', '1d_view', '7d_view', '28d_view', '1d_ev_view']::text[]
    )
  );

COMMENT ON COLUMN ad_integrations.attribution_windows IS 'Janelas de atribuicao pedidas a Meta para este vinculo (action_attribution_windows). NULL = o padrao que a Meta aplica.';
