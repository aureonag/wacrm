-- ============================================================
-- 118_affiliates_access_permission.sql — permissão "Acessar Afiliados"
--
-- Hoje Operacional → Afiliados só abre para dono/admin da conta (regra
-- provisória da 100). Para liberar a área a quem NÃO é admin (ex.: alguém do
-- time de operação) sem dar poderes de admin, cria-se a permissão
-- `operational:affiliates:access`.
--
-- Diferente da visibilidade do menu (`comercial:op_affiliates:view`, que foi
-- concedida a todos os cargos pela 115), esta NÃO é concedida a nenhum cargo:
-- quem não é dono/admin só passa se receber a permissão (por pessoa em
-- "Gerenciar acesso" ou por cargo em "Cargos e permissões").
--
-- Não altera nenhuma função, política ou permissão existente.
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

INSERT INTO permissions (environment, module, action, label) VALUES
  ('operational', 'affiliates', 'access', 'Acessar Afiliados')
ON CONFLICT (environment, module, action) DO NOTHING;
