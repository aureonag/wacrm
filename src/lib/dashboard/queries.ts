import type { Deal, PipelineStage } from '@/types'
import type { ActivityItem, DealSourceSlice, LostReasonSlice, PipelineDonutData, PipelineStageSlice } from './types'
import { monthBucketsInRange, monthKey, type DateRange } from './period'

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
