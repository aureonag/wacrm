-- ============================================================
-- 051_prospecting_external_origin.sql — Prospecção: origem externa
--
-- Suporta um segundo caminho de entrada de candidatos, além da busca
-- via IA+Google Places: colar texto pesquisado por um Claude local do
-- usuário, ou fazer upload de uma planilha (CSV/XLSX). Nenhum dos dois
-- caminhos chama OpenAI nem Google Places — só reaproveita o motor de
-- enriquecimento (site/Instagram, ambos gratuitos), pontuação ICP e
-- deduplicação que já existem.
--
-- `origin` deixa o motor (`engine.ts`) saber que deve pular a etapa
-- `searching` (Google Places) — os candidatos já chegam inseridos pela
-- própria rota que cria a run.
--
-- `requested_quantity` tinha CHECK 1-50 (limite pensado pra busca paga
-- via IA). Uploads de planilha podem ter centenas de linhas, então o
-- limite é ampliado para 1000 (um teto técnico de sanidade, não uma
-- ausência de limite — o motor processa em lotes de 5 por tick, então
-- um teto generoso ainda é seguro). O limite de 50 continua vigente
-- apenas na v1 do caminho `ai_chat`, aplicado em código
-- (`PROSPECTING_MAX_QUANTITY`), não neste CHECK.
--
-- Idempotente — seguro rodar múltiplas vezes.
-- ============================================================

ALTER TABLE prospecting_runs
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'ai_chat'
    CHECK (origin IN ('ai_chat', 'external_paste', 'external_upload'));

ALTER TABLE prospecting_runs DROP CONSTRAINT IF EXISTS prospecting_runs_requested_quantity_check;
ALTER TABLE prospecting_runs ADD CONSTRAINT prospecting_runs_requested_quantity_check
  CHECK (requested_quantity BETWEEN 1 AND 1000);
