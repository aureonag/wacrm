-- Reportei: edicao do relatorio salvo e validade do link publico.
--   subtitle          subtitulo da capa (opcional)
--   share_expires_at  quando o link publico deixa de funcionar (NULL = nao expira)
-- As escolhas de exibicao (metricas, grafico, introducao) ja ficam no snapshot
-- (snapshot.options), entao editar o que aparece nao precisa de coluna nova.

ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS subtitle text CHECK (subtitle IS NULL OR char_length(subtitle) <= 300);
ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
