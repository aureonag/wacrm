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
