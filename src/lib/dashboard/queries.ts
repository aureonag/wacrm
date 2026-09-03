import type { Deal, DealStageHistoryRow, PipelineStage } from '@/types'
import type { PipelineNextStep } from '@/lib/pipelines/queries'
import { sumLineItems } from '@/lib/pipelines/queries'
import type {
  ActivityItem,
  AvgTimeToCloseResult,
  ConversionRateResult,
  DealSourceSlice,
  FollowUpSummary,
  LostReasonSlice,
  NewMrrResult,
  PipelineDonutData,
  PipelineStageSlice,
  StageFunnelStep,
  StalledBucket,
  WinLossRateResult,
} from './types'
import { isWithinRange, monthBucketsInRange, monthKey, type DateRange } from './period'

// ------------------------------------------------------------
// The dashboard is scoped to one pipeline at a time (selected via the
// PipelineSelector on the page). Stages + deals for that pipeline are
// already loaded by the page (via src/lib/pipelines/queries.ts) to
// drive PipelineAnalytics, so the donut and the activity feed are both
// built from that same in-memory data — no separate query needed.
// ------------------------------------------------------------

// --- Pipeline donut, from already-loaded stages/deals -------------------

export function buildPipelineDonutFromDeals(
  stages: PipelineStage[],
  deals: Deal[],
): PipelineDonutData {
  const openDeals = deals.filter((d) => d.status === 'open')

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of openDeals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- Activity feed, from already-loaded stages/deals ---------------------

export interface PipelineActivityLabels {
  inStage: (title: string, stage: string) => string
  updated: (title: string) => string
}

export function buildPipelineActivity(
  stages: PipelineStage[],
  deals: Deal[],
  limit: number | undefined,
  labels: PipelineActivityLabels,
  periodRange?: { start: Date; end: Date },
): ActivityItem[] {
  const stageNameById = new Map(stages.map((s) => [s.id, s.name]))
  const at = (d: Deal) => d.updated_at ?? d.created_at

  // "Activity" is about what happened, not a creation cohort — a deal
  // counts if it was either created OR last touched inside the window,
  // matching "adições e modificações" from the spec.
  const inRange = (d: Deal) => {
    if (!periodRange) return true
    const start = periodRange.start.getTime()
    const end = periodRange.end.getTime()
    const created = new Date(d.created_at).getTime()
    const updated = new Date(at(d)).getTime()
    return (created >= start && created <= end) || (updated >= start && updated <= end)
  }

  const sorted = [...deals]
    .filter(inRange)
    .sort((a, b) => (at(a) > at(b) ? -1 : at(a) < at(b) ? 1 : 0))
  const limited = limit === undefined ? sorted : sorted.slice(0, limit)

  return limited.map((d) => {
    const stageName = stageNameById.get(d.stage_id)
    return {
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stageName ? labels.inStage(d.title, stageName) : labels.updated(d.title),
      at: at(d),
      href: '/pipelines',
    }
  })
}

// --- "Contratos fechados por mês" card ------------------------------------

export interface ClosedDealsMonthBucket {
  month: Date
  count: number
  value: number
}

/** Won deals only, bucketed by the month of their `closed_at`, one bucket
 *  per calendar month in `range` (zero-filled so the chart never skips a
 *  month just because nothing closed in it). */
export function buildClosedDealsByMonth(deals: Deal[], range: DateRange): ClosedDealsMonthBucket[] {
  const buckets = new Map<string, ClosedDealsMonthBucket>()
  for (const m of monthBucketsInRange(range)) {
    buckets.set(monthKey(m), { month: m, count: 0, value: 0 })
  }

  for (const d of deals) {
    if (d.status !== 'won' || !d.closed_at) continue
    const closed = new Date(d.closed_at)
    if (closed.getTime() < range.start.getTime() || closed.getTime() > range.end.getTime()) continue
    const bucket = buckets.get(monthKey(closed))
    if (!bucket) continue
    bucket.count += 1
    bucket.value += d.value ?? 0
  }

  return [...buckets.values()].sort((a, b) => a.month.getTime() - b.month.getTime())
}

// --- "Origem dos negócios" card -------------------------------------------

const UNINFORMED = '__uninformed__'

/** Breaks every deal down by `origin` — every deal counts once (including
 *  ones with no origin recorded, bucketed as `UNINFORMED` so percentages
 *  still sum to 100 and old data doesn't just disappear from the report),
 *  sorted by deal count descending. */
export function buildDealSourceBreakdown(deals: Deal[]): DealSourceSlice[] {
  const byOrigin = new Map<string, { count: number; totalValue: number; wonCount: number; wonValue: number }>()
  for (const d of deals) {
    const key = d.origin?.trim() || UNINFORMED
    const row = byOrigin.get(key) ?? { count: 0, totalValue: 0, wonCount: 0, wonValue: 0 }
    row.count += 1
    row.totalValue += d.value ?? 0
    if (d.status === 'won') {
      row.wonCount += 1
      row.wonValue += d.value ?? 0
    }
    byOrigin.set(key, row)
  }

  const total = deals.length || 1
  return [...byOrigin.entries()]
    .map(([origin, row]) => ({
      origin: origin === UNINFORMED ? null : origin,
      count: row.count,
      percent: (row.count / total) * 100,
      totalValue: row.totalValue,
      wonCount: row.wonCount,
      wonValue: row.wonValue,
    }))
    .sort((a, b) => b.count - a.count)
}

// --- "Motivos de perda" card -----------------------------------------------

/** Lost deals only, broken down by `lost_reason` (a deal with no reason
 *  recorded is bucketed as `null` rather than dropped), sorted by count
 *  descending. Percentages are of total LOST deals, not all deals. */
export function buildLostReasonBreakdown(deals: Deal[]): LostReasonSlice[] {
  const lost = deals.filter((d) => d.status === 'lost')
  const byReason = new Map<string, { count: number; totalValue: number }>()
  for (const d of lost) {
    const key = d.lost_reason?.trim() || UNINFORMED
    const row = byReason.get(key) ?? { count: 0, totalValue: 0 }
    row.count += 1
    row.totalValue += d.value ?? 0
    byReason.set(key, row)
  }

  const total = lost.length || 1
  return [...byReason.entries()]
    .map(([reason, row]) => ({
      reason: reason === UNINFORMED ? null : reason,
      count: row.count,
      percent: (row.count / total) * 100,
      totalValue: row.totalValue,
    }))
    .sort((a, b) => b.count - a.count)
}

// --- PERFORMANCE group -----------------------------------------------------

/** Cohort = every deal created within the period, whatever its current
 *  status. Conversion = how many of that cohort ended up won — a deal
 *  still open, or lost, both count against the cohort without counting
 *  as a conversion (per the spec: never compute this off open deals alone). */
export function buildConversionRate(deals: Deal[], range: DateRange): ConversionRateResult {
  const cohort = deals.filter((d) => isWithinRange(d.created_at, range))
  const wonCount = cohort.filter((d) => d.status === 'won').length
  return {
    cohortSize: cohort.length,
    wonCount,
    rate: cohort.length > 0 ? (wonCount / cohort.length) * 100 : 0,
  }
}

/** Only deals actually decided (won or lost) within the period, by
 *  `closed_at` — open deals don't enter this at all, matching
 *  `pipeline-analytics.tsx`'s existing won/lost-in-window logic. */
export function buildWinLossRate(deals: Deal[], range: DateRange): WinLossRateResult {
  const decided = (status: Deal['status']) =>
    deals.filter((d) => d.status === status && d.closed_at && isWithinRange(d.closed_at, range))
  const wonCount = decided('won').length
  const lostCount = decided('lost').length
  const total = wonCount + lostCount
  return {
    wonCount,
    lostCount,
    winRate: total > 0 ? (wonCount / total) * 100 : 0,
    lossRate: total > 0 ? (lostCount / total) * 100 : 0,
  }
}

/** Average days between creation and close, won deals only, by `closed_at`
 *  within the period. */
export function buildAvgTimeToClose(deals: Deal[], range: DateRange): AvgTimeToCloseResult {
  const won = deals.filter((d) => d.status === 'won' && d.closed_at && isWithinRange(d.closed_at, range))
  if (won.length === 0) return { wonCount: 0, avgDays: null }
  const totalDays = won.reduce((sum, d) => {
    const days = (new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime()) / 86_400_000
    return sum + Math.max(days, 0)
  }, 0)
  return { wonCount: won.length, avgDays: totalDays / won.length }
}

/** "Novo MRR" — sum of each won deal's recurring (`mensal`) line items,
 *  never `deal.value` (which can be a one-off total). Deals without
 *  hydrated `lineItems` (shouldn't happen via loadPipelineDeals) count 0. */
export function buildNewMrr(deals: Deal[], range: DateRange): NewMrrResult {
  const won = deals.filter((d) => d.status === 'won' && d.closed_at && isWithinRange(d.closed_at, range))
  const totalMrr = won.reduce((sum, d) => sum + sumLineItems(d.lineItems ?? [], 'mensal'), 0)
  return { wonCount: won.length, totalMrr }
}

// --- FUNIL group -------------------------------------------------------

const MIN_STAGE_SAMPLES = 3

/** Conversion + average dwell time per stage, from `deal_stage_history`
 *  (migration 057). Only transitions actually recorded count — there is no
 *  retroactive data, so a stage reports `hasEnoughData: false` until deals
 *  have genuinely moved through it a few times after the migration shipped. */
export function buildStageFunnel(stages: PipelineStage[], historyRows: DealStageHistoryRow[]): StageFunnelStep[] {
  const sortedStages = [...stages].sort((a, b) => a.position - b.position)
  const nextStageId = new Map(sortedStages.map((s, i) => [s.id, sortedStages[i + 1]?.id]))

  const byDeal = new Map<string, DealStageHistoryRow[]>()
  for (const row of historyRows) {
    const bucket = byDeal.get(row.deal_id) ?? []
    bucket.push(row)
    byDeal.set(row.deal_id, bucket)
  }

  const enteredBy = new Map<string, Set<string>>()
  const dwellDaysBy = new Map<string, number[]>()
  const advancedBy = new Map<string, Set<string>>()

  for (const [dealId, rows] of byDeal) {
    const ordered = [...rows].sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
    for (let i = 0; i < ordered.length; i++) {
      const stageId = ordered[i].to_stage_id
      const enteredSet = enteredBy.get(stageId) ?? new Set<string>()
      enteredSet.add(dealId)
      enteredBy.set(stageId, enteredSet)

      const next = ordered[i + 1]
      if (!next) continue
      const days = (new Date(next.changed_at).getTime() - new Date(ordered[i].changed_at).getTime()) / 86_400_000
      const dwellList = dwellDaysBy.get(stageId) ?? []
      dwellList.push(Math.max(days, 0))
      dwellDaysBy.set(stageId, dwellList)

      if (next.to_stage_id === nextStageId.get(stageId)) {
        const advancedSet = advancedBy.get(stageId) ?? new Set<string>()
        advancedSet.add(dealId)
        advancedBy.set(stageId, advancedSet)
      }
    }
  }

  return sortedStages.map((stage) => {
    const enteredCount = enteredBy.get(stage.id)?.size ?? 0
    const dwellDays = dwellDaysBy.get(stage.id) ?? []
    const isLastStage = !nextStageId.get(stage.id)
    const advancedCount = isLastStage ? null : (advancedBy.get(stage.id)?.size ?? 0)

    return {
      stageId: stage.id,
      stageName: stage.name,
      enteredCount,
      advancedCount,
      conversionRate:
        advancedCount === null || enteredCount === 0 ? null : (advancedCount / enteredCount) * 100,
      avgDaysInStage:
        dwellDays.length > 0 ? dwellDays.reduce((sum, d) => sum + d, 0) / dwellDays.length : null,
      hasEnoughData: dwellDays.length >= MIN_STAGE_SAMPLES,
    }
  })
}

// --- ATENÇÃO/AÇÃO group -----------------------------------------------

const STALLED_THRESHOLDS_DAYS = [3, 7, 15, 30]

/** Open deals bucketed by days since `last_activity_at` (migration 057).
 *  Cumulative — "+7 dias" includes every deal that also qualifies for
 *  "+15"/"+30", matching the spec's own example. */
/** Open deals whose `last_activity_at` is at least `minDays` old. Exported
 *  so the "click a bucket, see the deals" dialog can reuse the exact same
 *  selection instead of recomputing `Date.now()` inline in a component. */
export function selectStalledDeals(deals: Deal[], minDays: number): Deal[] {
  const now = Date.now()
  return deals.filter((d) => {
    if (d.status !== 'open') return false
    const days = (now - new Date(d.last_activity_at).getTime()) / 86_400_000
    return days >= minDays
  })
}

export function buildStalledDeals(deals: Deal[]): StalledBucket[] {
  return STALLED_THRESHOLDS_DAYS.map((minDays) => {
    const matching = selectStalledDeals(deals, minDays)
    return {
      minDays,
      count: matching.length,
      totalValue: matching.reduce((sum, d) => sum + (d.value ?? 0), 0),
    }
  })
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Follow-ups due today vs. already overdue, both restricted to `!done` —
 *  same date-only comparison the "Minhas atividades" page already uses. */
export function buildFollowUpSummary(nextSteps: PipelineNextStep[]): FollowUpSummary {
  const today = localDateKey(new Date())
  const pending = nextSteps.filter((s) => !s.done && s.due_date)
  return {
    dueTodayCount: pending.filter((s) => s.due_date === today).length,
    overdueCount: pending.filter((s) => (s.due_date as string) < today).length,
  }
}
