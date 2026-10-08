-- ============================================================
-- 115_nav_permissions_all_items.sql — visibilidade do menu lateral para TODOS
-- os itens, por seção
--
-- A 079/093 criaram a permissão "Visualizar" (`comercial:<item>:view`) só para
-- parte dos itens do menu. Faltavam: o Dashboard do Comercial, a seção
-- Comercial inteira, os itens de dentro do Operacional (Dashboard, Gestão de
-- Tarefas, Clientes, Afiliados) e os submenus de Materiais (Comercial, Mídia).
-- Por isso a tela "Gerenciar acesso" não conseguia controlar esses itens.
--
-- Mesmo padrão da 079/093: só VISIBILIDADE no menu (não bloqueia a rota), usa a
-- mesma tabela `permissions` e os mesmos overrides por pessoa — nenhuma função,
-- política ou permissão existente é alterada.
--
-- Backfill (obrigatório, como na 093): inserir uma permissão não a concede a
-- ninguém. Todos esses itens já aparecem hoje para quem tem acesso ao ambiente,
-- então concedemos a cada cargo existente; sem isso todo mundo (menos o dono)
-- perderia o item no instante do deploy.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

INSERT INTO permissions (environment, module, action, label) VALUES
  ('comercial', 'section_comercial', 'view', 'Visualizar'),
  ('comercial', 'dashboard',         'view', 'Visualizar'),
  ('comercial', 'op_dashboard',      'view', 'Visualizar'),
  ('comercial', 'op_boards',         'view', 'Visualizar'),
  ('comercial', 'op_clients',        'view', 'Visualizar'),
  ('comercial', 'op_affiliates',     'view', 'Visualizar'),
  ('comercial', 'mat_comercial',     'view', 'Visualizar'),
  ('comercial', 'mat_midia',         'view', 'Visualizar')
ON CONFLICT (environment, module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.environment = 'comercial'
   AND p.action = 'view'
   AND p.module IN (
     'section_comercial', 'dashboard',
     'op_dashboard', 'op_boards', 'op_clients', 'op_affiliates',
     'mat_comercial', 'mat_midia'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;
