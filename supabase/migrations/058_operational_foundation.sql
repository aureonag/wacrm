-- ============================================================
-- 058_operational_foundation.sql — ETAPA 1: fundação do ambiente
-- Operacional + sistema de Cargos/Permissões/Setores.
--
-- Design notes
--   - Comercial e Operacional são dois AMBIENTES da MESMA conta, não duas
--     contas. `accounts`/`profiles.account_id`/`account_role`/
--     `is_account_member()` (migration 017) são o pontochave de
--     multi-tenancy do schema inteiro (18 migrations, 86+ call sites só na
--     017) e ficam absolutamente intocados aqui.
--   - Proprietário = account_role 'owner', que já é o nível máximo de
--     `is_account_member`. Nenhum valor novo em account_role_enum.
--   - `permissions` é um catálogo GLOBAL (não por conta) — é a lista de
--     capacidades que a plataforma sabe oferecer, cresce a cada módulo
--     novo (Etapa 2 insere as permissões de "Gestão de Tarefas" reais).
--   - `roles`/`sectors`/etc. são por conta — cada conta define seus
--     próprios cargos/setores customizados.
--   - Esta é uma camada ADICIONAL: nenhuma RLS/rota existente muda.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- permissions (catálogo global) --------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('comercial', 'operational')),
  module      text NOT NULL,
  action      text NOT NULL,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, module, action)
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_select ON permissions;
CREATE POLICY permissions_select ON permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

INSERT INTO permissions (environment, module, action, label) VALUES
  ('comercial', 'dashboard', 'view', 'Visualizar'),
  ('comercial', 'pipelines', 'view', 'Visualizar'),
  ('comercial', 'pipelines', 'create', 'Criar'),
  ('comercial', 'pipelines', 'edit', 'Editar'),
  ('comercial', 'pipelines', 'delete', 'Excluir'),
  ('comercial', 'deals', 'view', 'Visualizar'),
  ('comercial', 'deals', 'create', 'Criar'),
  ('comercial', 'deals', 'edit', 'Editar'),
  ('comercial', 'deals', 'delete', 'Excluir'),
  ('comercial', 'contacts', 'view', 'Visualizar'),
  ('comercial', 'contacts', 'create', 'Criar'),
  ('comercial', 'contacts', 'edit', 'Editar'),
  ('comercial', 'contacts', 'delete', 'Excluir'),
  ('operational', 'dashboard', 'view', 'Visualizar'),
  ('operational', 'tasks', 'view_boards', 'Visualizar quadros'),
  ('operational', 'tasks', 'create_boards', 'Criar quadros'),
  ('operational', 'tasks', 'edit_boards', 'Editar quadros'),
  ('operational', 'tasks', 'delete_boards', 'Excluir quadros'),
  ('operational', 'tasks', 'view_tasks', 'Visualizar tarefas'),
  ('operational', 'tasks', 'create_tasks', 'Criar tarefas'),
  ('operational', 'tasks', 'edit_tasks', 'Editar tarefas'),
  ('operational', 'tasks', 'move_tasks', 'Mover tarefas'),
  ('operational', 'tasks', 'comment', 'Comentar'),
  ('operational', 'tasks', 'add_files', 'Adicionar arquivos'),
  ('operational', 'tasks', 'delete_tasks', 'Excluir tarefas')
ON CONFLICT (environment, module, action) DO NOTHING;

-- ---- roles (cargos, por conta) -------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  name              text NOT NULL,
  environments      text[] NOT NULL DEFAULT '{}',
  is_system_default boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles FOR DELETE
  USING (is_account_member(account_id, 'admin') AND NOT is_system_default);

DROP TRIGGER IF EXISTS set_updated_at ON roles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- role_permissions -----------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND is_account_member(r.account_id)));
DROP POLICY IF EXISTS role_permissions_insert ON role_permissions;
CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND is_account_member(r.account_id, 'admin')));
DROP POLICY IF EXISTS role_permissions_delete ON role_permissions;
CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND is_account_member(r.account_id, 'admin')));

-- ---- sectors ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sectors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sectors_select ON sectors;
CREATE POLICY sectors_select ON sectors FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS sectors_insert ON sectors;
CREATE POLICY sectors_insert ON sectors FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS sectors_delete ON sectors;
CREATE POLICY sectors_delete ON sectors FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- user_sectors -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sectors (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sector_id  uuid NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, sector_id)
);

ALTER TABLE user_sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_sectors_select ON user_sectors;
CREATE POLICY user_sectors_select ON user_sectors FOR SELECT
  USING (EXISTS (SELECT 1 FROM sectors s WHERE s.id = user_sectors.sector_id AND is_account_member(s.account_id)));
DROP POLICY IF EXISTS user_sectors_insert ON user_sectors;
CREATE POLICY user_sectors_insert ON user_sectors FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sectors s WHERE s.id = user_sectors.sector_id AND is_account_member(s.account_id, 'admin')));
DROP POLICY IF EXISTS user_sectors_delete ON user_sectors;
CREATE POLICY user_sectors_delete ON user_sectors FOR DELETE
  USING (EXISTS (SELECT 1 FROM sectors s WHERE s.id = user_sectors.sector_id AND is_account_member(s.account_id, 'admin')));

-- ---- user_permission_overrides (arquitetura pronta, sem UI nesta etapa) ----
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted       boolean NOT NULL,
  PRIMARY KEY (profile_id, permission_id)
);

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_permission_overrides_select ON user_permission_overrides;
CREATE POLICY user_permission_overrides_select ON user_permission_overrides FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = user_permission_overrides.profile_id AND is_account_member(p.account_id)));
DROP POLICY IF EXISTS user_permission_overrides_insert ON user_permission_overrides;
CREATE POLICY user_permission_overrides_insert ON user_permission_overrides FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = user_permission_overrides.profile_id AND is_account_member(p.account_id, 'admin')));
DROP POLICY IF EXISTS user_permission_overrides_delete ON user_permission_overrides;
CREATE POLICY user_permission_overrides_delete ON user_permission_overrides FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = user_permission_overrides.profile_id AND is_account_member(p.account_id, 'admin')));

-- ---- profiles.role_id -------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id) ON DELETE SET NULL;

-- ---- functions --------------------------------------------------------------

-- Same shape as is_account_member: SECURITY DEFINER, callable from RLS
-- (future Etapa 2+ tables) and directly via .rpc() from the app.
CREATE OR REPLACE FUNCTION has_environment_access(target_environment text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN roles r ON r.id = p.role_id
    WHERE p.user_id = auth.uid()
      AND (p.account_role = 'owner' OR target_environment = ANY(r.environments))
  );
$$;

CREATE OR REPLACE FUNCTION has_permission(p_environment text, p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND account_role = 'owner') THEN true
    ELSE COALESCE(
      (SELECT upo.granted
         FROM profiles p
         JOIN user_permission_overrides upo ON upo.profile_id = p.id
         JOIN permissions perm ON perm.id = upo.permission_id
        WHERE p.user_id = auth.uid()
          AND perm.environment = p_environment AND perm.module = p_module AND perm.action = p_action),
      EXISTS (
        SELECT 1
          FROM profiles p
          JOIN role_permissions rp ON rp.role_id = p.role_id
          JOIN permissions perm ON perm.id = rp.permission_id
         WHERE p.user_id = auth.uid()
           AND perm.environment = p_environment AND perm.module = p_module AND perm.action = p_action
      ),
      false
    )
  END;
$$;

-- Resolved permission set for the caller, in one round trip — avoids the
-- client issuing one has_permission() RPC per UI check.
CREATE OR REPLACE FUNCTION get_my_permissions()
RETURNS TABLE(environment text, module text, action text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id AS profile_id, p.role_id, p.account_role
    FROM profiles p
    WHERE p.user_id = auth.uid()
  )
  SELECT perm.environment, perm.module, perm.action
    FROM permissions perm, me
   WHERE me.account_role = 'owner'
  UNION
  SELECT perm.environment, perm.module, perm.action
    FROM role_permissions rp
    JOIN permissions perm ON perm.id = rp.permission_id
    JOIN me ON me.role_id = rp.role_id
   WHERE NOT EXISTS (
     SELECT 1 FROM user_permission_overrides upo
      WHERE upo.profile_id = me.profile_id AND upo.permission_id = perm.id AND upo.granted = false
   )
  UNION
  SELECT perm.environment, perm.module, perm.action
    FROM user_permission_overrides upo
    JOIN permissions perm ON perm.id = upo.permission_id
    JOIN me ON me.profile_id = upo.profile_id
   WHERE upo.granted = true;
$$;

-- ---- backfill: 3 cargos padrão por conta + associação dos profiles --------
DO $$
DECLARE
  acct RECORD;
  admin_role_id uuid;
  comercial_role_id uuid;
  viewer_role_id uuid;
BEGIN
  FOR acct IN SELECT id FROM accounts LOOP
    INSERT INTO roles (account_id, name, environments, is_system_default)
    VALUES (acct.id, 'Administrador', ARRAY['comercial', 'operational'], true)
    ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO admin_role_id;

    INSERT INTO roles (account_id, name, environments, is_system_default)
    VALUES (acct.id, 'Comercial', ARRAY['comercial'], true)
    ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO comercial_role_id;

    INSERT INTO roles (account_id, name, environments, is_system_default)
    VALUES (acct.id, 'Visualizador', ARRAY['comercial'], true)
    ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO viewer_role_id;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT admin_role_id, id FROM permissions
    ON CONFLICT DO NOTHING;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT comercial_role_id, id FROM permissions WHERE environment = 'comercial'
    ON CONFLICT DO NOTHING;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT viewer_role_id, id FROM permissions WHERE environment = 'comercial' AND action = 'view'
    ON CONFLICT DO NOTHING;

    UPDATE profiles SET role_id = admin_role_id
     WHERE account_id = acct.id AND account_role IN ('owner', 'admin') AND role_id IS NULL;
    UPDATE profiles SET role_id = comercial_role_id
     WHERE account_id = acct.id AND account_role = 'agent' AND role_id IS NULL;
    UPDATE profiles SET role_id = viewer_role_id
     WHERE account_id = acct.id AND account_role = 'viewer' AND role_id IS NULL;
  END LOOP;
END $$;
