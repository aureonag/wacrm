-- Reportei: as redes de cada relatorio, para os icones da lista (cartao Relatorios
-- da ficha do cliente e tela Relatorios). Os relatorios gerados ate aqui leem so a
-- Meta Ads, entao esse e o padrao. O documento do relatorio (blocos e indicadores)
-- fica dentro do snapshot (snapshot.doc), sem coluna propria.

ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS networks text[] NOT NULL DEFAULT '{meta_ads}';
