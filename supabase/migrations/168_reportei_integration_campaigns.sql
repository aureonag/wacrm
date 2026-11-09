-- Reportei: escolher campanhas. Cada conta de anuncios ligada a um cliente pode
-- ser lida inteira (campaign_ids NULL) ou so por algumas campanhas, como o
-- "Escolher detalhes -> selecionar campanhas" do Reportei. Vale para relatorios,
-- automacoes e dashboards do cliente.

ALTER TABLE ad_integrations ADD COLUMN IF NOT EXISTS campaign_ids text[];
COMMENT ON COLUMN ad_integrations.campaign_ids IS 'Campanhas da conta usadas nos relatorios e dashboards. NULL = toda a conta.';
