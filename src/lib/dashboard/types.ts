// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

/** One row of the "Origem dos negócios" breakdown. `origin === null` means
 *  the deal has no recorded source (shown as "not informed"). */
export interface DealSourceSlice {
  origin: string | null
  count: number
  percent: number
  totalValue: number
  wonCount: number
  wonValue: number
}

/** One row of the "Motivos de perda" breakdown, lost deals only.
 *  `reason === null` means the deal was lost before this field existed. */
export interface LostReasonSlice {
  reason: string | null
  count: number
  percent: number
  totalValue: number
}

// --- PERFORMANCE group -----------------------------------------------------

export interface ConversionRateResult {
  /** Deals created within the period (open + won + lost). */
  cohortSize: number
  wonCount: number
  /** 0-100. */
  rate: number
}

export interface WinLossRateResult {
  wonCount: number
  lostCount: number
  /** 0-100, of decided (won+lost) deals. 0 when nothing was decided. */
  winRate: number
  lossRate: number
}

export interface AvgTimeToCloseResult {
  wonCount: number
  /** Average days between created_at and closed_at, null if no won deals. */
  avgDays: number | null
}

/** Won deals in the period, using each deal's recurring (mensal) line
 *  items — never the deal's total value. */
export interface NewMrrResult {
  wonCount: number
  totalMrr: number
}

// --- FUNIL group -------------------------------------------------------

export interface StageFunnelStep {
  stageId: string
  stageName: string
  /** Deals that ever reached this stage. */
  enteredCount: number
  /** Of those, how many advanced to the next stage — null for the last stage. */
  advancedCount: number | null
  /** 0-100, null for the last stage. */
  conversionRate: number | null
  /** Average days spent in this stage before leaving it, null if the deal
   *  never left (still current) or there's no matching "next" transition. */
  avgDaysInStage: number | null
  /** False once a stage has at least a handful of completed transitions —
   *  before that, the numbers above are too thin to display as fact. */
  hasEnoughData: boolean
}

// --- ATENÇÃO/AÇÃO group -----------------------------------------------

export interface StalledBucket {
  minDays: number
  count: number
  totalValue: number
}

export interface FollowUpSummary {
  dueTodayCount: number
  overdueCount: number
}
