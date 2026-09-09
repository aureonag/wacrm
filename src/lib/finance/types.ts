// ============================================================
// Shared row shapes for the Financeiro module (owner-only).
// Mirrors migration 080_financial_module.sql exactly — keep in sync.
// ============================================================

export interface FinServiceLine {
  id: string
  account_id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type FinClientStatus = 'active' | 'ended'

export interface FinClient {
  id: string
  account_id: string
  service_line_id: string
  code: string | null
  name: string
  status: FinClientStatus
  started_at: string | null
  ended_at: string | null
  sort_order: number
  /** Which team member runs this account — distinct from
   *  `fin_team_allocations`, which tracks a person's monthly *cost* to a
   *  line regardless of whether they run a specific client (e.g. an art
   *  director producing assets for the whole line has no client here). */
  responsible_team_member_id: string | null
  created_at: string
  updated_at: string
}

export interface FinClientValue {
  id: string
  account_id: string
  client_id: string
  year: number
  month: number
  amount: number
  created_at: string
  updated_at: string
}

export interface FinTeamMember {
  id: string
  account_id: string
  name: string
  salary_total: number
  payment1_label: string
  payment1_amount: number
  payment2_label: string
  payment2_amount: number
  document: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FinTeamAllocation {
  id: string
  account_id: string
  service_line_id: string
  team_member_id: string | null
  freelancer_name: string | null
  year: number
  month: number
  amount: number
  created_at: string
  updated_at: string
}

export interface FinExpenseCategory {
  id: string
  account_id: string
  name: string
  is_recurring: boolean
  created_at: string
}

export interface FinExpense {
  id: string
  account_id: string
  category_id: string
  year: number
  month: number
  amount: number
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FinReceiptStatus = 'needs_review' | 'confirmed' | 'rejected' | 'failed'

export interface FinReceipt {
  id: string
  account_id: string
  file_path: string
  file_name: string
  mime_type: string
  description: string
  status: FinReceiptStatus
  suggested_category_id: string | null
  suggested_amount: number | null
  suggested_year: number | null
  suggested_month: number | null
  suggested_description: string | null
  ai_notes: string | null
  error_message: string | null
  confirmed_expense_id: string | null
  created_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export const MONTH_NAMES_PT: readonly string[] = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]
