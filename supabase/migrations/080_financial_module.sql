-- ============================================================
-- 080_financial_module.sql — "Financeiro" module.
--
-- Internal financial forecast/tracking for the account OWNER only —
-- mirrors an existing spreadsheet (service lines with recurring
-- clients + team cost allocation + a rollup "Balanço", plus a global
-- fixed-expenses list). Every table here is gated to the 'owner' role
-- and ONLY the owner role — this is intentionally NOT wired into the
-- Cargos+Permissões catalog (migrations 058/079), because that system
-- lets an owner/admin grant permissions to other roles, and this data
-- must never become grantable. `is_account_member(account_id, 'owner')`
-- is the strictest tier the helper supports (owner = rank 4, the max),
-- so it's an exact "only the owner" check, not a minimum.
--
-- Design notes
--   - fin_client_values is one row per (client, year, month) rather than
--     a single "current value" column, because the source spreadsheet
--     already shows a client's monthly fee changing over time — that
--     history is the point, not an incidental detail.
--   - fin_team_allocations covers two cost shapes seen in the sheet:
--     a fixed team member's cost allocated to a service line for a given
--     month (team_member_id set), or a one-off freelancer with no master
--     record (freelancer_name set, team_member_id null). Exactly one of
--     the two must be present (CHECK below).
--   - fin_receipts is the AI-assisted comprovante intake: a receipt is
--     never auto-posted. It holds the AI's suggestion (category/amount/
--     period) separately from the eventual fin_expenses row, which is
--     only created once the owner confirms (possibly after correcting
--     the suggestion) via the API route — never by a DB trigger.
--   - No seed data: service lines and expense categories are business
--     names specific to each account (e.g. this account's "Tráfego
--     Pago"/"Social Media"/"Hospedagem"), not something every account
--     using this CRM should get by default. The owner adds them once
--     from the Financeiro UI.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ---- fin_service_lines ---------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_service_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);
CREATE INDEX IF NOT EXISTS idx_fin_service_lines_account ON fin_service_lines(account_id);

ALTER TABLE fin_service_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_service_lines_owner ON fin_service_lines;
CREATE POLICY fin_service_lines_owner ON fin_service_lines FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_service_lines;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_service_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_clients ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_line_id  uuid NOT NULL REFERENCES fin_service_lines(id) ON DELETE CASCADE,
  code             text,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at       date,
  ended_at         date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_clients_account ON fin_clients(account_id);
CREATE INDEX IF NOT EXISTS idx_fin_clients_service_line ON fin_clients(service_line_id);

ALTER TABLE fin_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_clients_owner ON fin_clients;
CREATE POLICY fin_clients_owner ON fin_clients FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_clients;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_client_values (one row per client per month) ---------------------
CREATE TABLE IF NOT EXISTS fin_client_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES fin_clients(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  month       integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_fin_client_values_period ON fin_client_values(account_id, year, month);

ALTER TABLE fin_client_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_client_values_owner ON fin_client_values;
CREATE POLICY fin_client_values_owner ON fin_client_values FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_client_values;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_client_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_team_members (master payroll registry) ----------------------------
-- payment1/2 are labeled, not day-of-month integers, because the source
-- sheet's first installment is "5º dia útil" (5th business day) — a
-- floating date, not a fixed day number.
CREATE TABLE IF NOT EXISTS fin_team_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  salary_total      numeric(12,2) NOT NULL DEFAULT 0,
  payment1_label    text NOT NULL DEFAULT '5º dia útil',
  payment1_amount   numeric(12,2) NOT NULL DEFAULT 0,
  payment2_label    text NOT NULL DEFAULT 'Dia 20',
  payment2_amount   numeric(12,2) NOT NULL DEFAULT 0,
  document          text,
  phone             text,
  email             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_team_members_account ON fin_team_members(account_id);

ALTER TABLE fin_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_team_members_owner ON fin_team_members;
CREATE POLICY fin_team_members_owner ON fin_team_members FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_team_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_team_allocations (cost-of-delivery per service line/month) -------
CREATE TABLE IF NOT EXISTS fin_team_allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_line_id  uuid NOT NULL REFERENCES fin_service_lines(id) ON DELETE CASCADE,
  team_member_id   uuid REFERENCES fin_team_members(id) ON DELETE SET NULL,
  freelancer_name  text,
  year             integer NOT NULL,
  month            integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (team_member_id IS NOT NULL AND freelancer_name IS NULL) OR
    (team_member_id IS NULL AND freelancer_name IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_fin_team_allocations_period
  ON fin_team_allocations(account_id, service_line_id, year, month);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_fin_team_allocations_member
  ON fin_team_allocations(service_line_id, team_member_id, year, month)
  WHERE team_member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_fin_team_allocations_freelancer
  ON fin_team_allocations(service_line_id, freelancer_name, year, month)
  WHERE freelancer_name IS NOT NULL;

ALTER TABLE fin_team_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_team_allocations_owner ON fin_team_allocations;
CREATE POLICY fin_team_allocations_owner ON fin_team_allocations FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_team_allocations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_team_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_expense_categories -------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_expense_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  is_recurring  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);
CREATE INDEX IF NOT EXISTS idx_fin_expense_categories_account ON fin_expense_categories(account_id);

ALTER TABLE fin_expense_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_expense_categories_owner ON fin_expense_categories;
CREATE POLICY fin_expense_categories_owner ON fin_expense_categories FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

-- ---- fin_expenses -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES fin_expense_categories(id) ON DELETE RESTRICT,
  year          integer NOT NULL,
  month         integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount        numeric(12,2) NOT NULL DEFAULT 0,
  description   text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_expenses_period ON fin_expenses(account_id, year, month);

ALTER TABLE fin_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_expenses_owner ON fin_expenses;
CREATE POLICY fin_expenses_owner ON fin_expenses FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_expenses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- fin_receipts (comprovante intake — AI suggestion, owner confirms) -----
CREATE TABLE IF NOT EXISTS fin_receipts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  file_path              text NOT NULL,
  file_name              text NOT NULL,
  mime_type              text NOT NULL,
  description            text NOT NULL,
  status                 text NOT NULL DEFAULT 'needs_review'
                           CHECK (status IN ('needs_review', 'confirmed', 'rejected', 'failed')),
  suggested_category_id  uuid REFERENCES fin_expense_categories(id) ON DELETE SET NULL,
  suggested_amount       numeric(12,2),
  suggested_year         integer,
  suggested_month        integer CHECK (suggested_month IS NULL OR suggested_month BETWEEN 1 AND 12),
  suggested_description  text,
  ai_notes               text,
  error_message          text,
  confirmed_expense_id   uuid REFERENCES fin_expenses(id) ON DELETE SET NULL,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_receipts_account_status ON fin_receipts(account_id, status);

ALTER TABLE fin_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_receipts_owner ON fin_receipts;
CREATE POLICY fin_receipts_owner ON fin_receipts FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON fin_receipts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fin_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
