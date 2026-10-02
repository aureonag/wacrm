-- ============================================================
-- 093_comercial_nav_extra_permissions.sql — extends migration 079's
-- `comercial:*:view` nav-visibility catalog to cover two sidebar
-- sections that grew after 079 shipped and were never wired up:
--   - Chat: today has no gate at all (migration 084) — every account
--     member reaches it regardless of cargo or override.
--   - Operacional (the section header, not its sub-items): today
--     gated only by whether the cargo's `environments` array includes
--     'operational' (`has_environment_access`), a separate mechanism
--     from the granular permissions/overrides system entirely. This
--     adds an ADDITIONAL menu-visibility permission layered on top of
--     that existing gate — same "visibility only, not a route guard"
--     scope the rest of this system already has (sidebar.tsx itself
--     still relies on `has_environment_access` wherever it actually
--     matters for access, this only controls whether the section
--     renders in the menu).
--
-- Why a backfill is required (same reasoning as 079): inserting a
-- permission row grants it to nobody by default. Both Chat and
-- Operacional are visible to everyone who has env access today, so
-- without backfilling every existing role would silently lose Chat
-- (and Operacional, for roles that already have operational env
-- access) the moment this deploys.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

INSERT INTO permissions (environment, module, action, label) VALUES
  ('comercial', 'chat', 'view', 'Visualizar'),
  ('comercial', 'operational', 'view', 'Visualizar')
ON CONFLICT (environment, module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.environment = 'comercial'
   AND p.module IN ('chat', 'operational')
   AND p.action = 'view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
