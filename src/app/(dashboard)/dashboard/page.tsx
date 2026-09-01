"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { GitBranch, Plus } from 'lucide-react'
import type { Deal, Pipeline, PipelineStage } from '@/types'

import { loadPipelines, loadPipelineStages, loadPipelineDeals } from '@/lib/pipelines/queries'
import { buildPipelineActivity, buildPipelineDonutFromDeals } from '@/lib/dashboard/queries'
import { getPeriodRange, isWithinRange, type DateRange, type PeriodKind } from '@/lib/dashboard/period'
import type { ActivityItem, PipelineDonutData } from '@/lib/dashboard/types'

import { PipelineSelector } from '@/components/pipelines/pipeline-selector'
import { PipelineAnalytics } from '@/components/pipelines/pipeline-analytics'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { PeriodFilter } from '@/components/dashboard/period-filter'
import { UserFilter } from '@/components/dashboard/user-filter'
import { ClosedDealsCard } from '@/components/dashboard/closed-deals-card'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const tPipelines = useTranslations('Pipelines.page')
  const tActivity = useTranslations('Dashboard.activityFeed')
  const { defaultCurrency } = useAuth()
  const router = useRouter()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  const [periodKind, setPeriodKind] = useState<PeriodKind>('all')
  const [customRange, setCustomRange] = useState<DateRange | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Initial pipeline list load. Unlike the Pipelines board, the
  // dashboard never seeds a default pipeline — it just points the
  // user at /pipelines (where that seeding already lives) when the
  // account has none yet.
  useEffect(() => {
    let cancelled = false
    const db = createClient()
    ;(async () => {
      const list = await loadPipelines(db)
      if (cancelled) return
      setPipelines(list)
      setSelectedPipelineId((prev) =>
        prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? ''),
      )
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load stages + deals whenever the selected pipeline changes.
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([])
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([])
      return
    }
    let cancelled = false
    const db = createClient()
    ;(async () => {
      const [s, d] = await Promise.all([
        loadPipelineStages(db, selectedPipelineId),
        loadPipelineDeals(db, selectedPipelineId),
      ])
      if (cancelled) return
      setStages(s)
      setDeals(d)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedPipelineId])

  // Switching pipeline resets the filters — a period/user combo from a
  // different pipeline isn't necessarily meaningful here (different
  // team, different volume).
  const handleSelectPipeline = useCallback((id: string) => {
    setSelectedPipelineId(id)
    setPeriodKind('all')
    setCustomRange(null)
    setUserId(null)
  }, [])

  const periodRange = useMemo(
    () => getPeriodRange(periodKind, customRange ?? undefined),
    [periodKind, customRange],
  )

  // User filter applies everywhere. The period filter, per spec, scopes
  // "what's in the funnel" (created_at cohort) for the metric cards and
  // the donut — but the activity feed has its own reading of the same
  // period (created OR updated), so it filters the user-only subset
  // itself via buildPipelineActivity's periodRange param instead of
  // this array.
  const dealsForUser = useMemo(
    () => (userId ? deals.filter((d) => d.user_id === userId) : deals),
    [deals, userId],
  )
  const dealsForPeriodAndUser = useMemo(
    () => dealsForUser.filter((d) => isWithinRange(d.created_at, periodRange)),
    [dealsForUser, periodRange],
  )

  const donut: PipelineDonutData = buildPipelineDonutFromDeals(stages, dealsForPeriodAndUser)
  const activity: ActivityItem[] = buildPipelineActivity(
    stages,
    dealsForUser,
    50,
    {
      inStage: (title, stage) => tActivity('dealInStage', { title, stage }),
      updated: (title) => tActivity('dealUpdated', { title }),
    },
    periodRange,
  )

  const activityHref = `/dashboard/activity?pipeline=${selectedPipelineId}&period=${periodKind}`

  const handleManage = useCallback(() => {
    router.push('/pipelines')
  }, [router])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted/50" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {pipelines.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <PipelineSelector
              pipelines={pipelines}
              selectedId={selectedPipelineId}
              onSelect={handleSelectPipeline}
              onManage={handleManage}
              placeholderLabel={tPipelines('selectPipeline')}
              emptyLabel={tPipelines('noPipelinesYet')}
              manageLabel={tPipelines('managePipelines')}
            />
            <UserFilter deals={deals} selectedUserId={userId} onChange={setUserId} />
          </div>
        )}
      </div>

      <QuickActions />

      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t('noPipelinesTitle')}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('noPipelinesDesc')}</p>
          <Link
            href="/pipelines"
            className="mt-4 inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('goToPipelines')}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodFilter
              kind={periodKind}
              custom={customRange}
              onChange={(kind, custom) => {
                setPeriodKind(kind)
                setCustomRange(custom ?? null)
              }}
            />
          </div>

          <PipelineAnalytics
            stages={stages}
            deals={dealsForPeriodAndUser}
            periodRange={periodRange}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="h-full lg:col-span-3">
              <ActivityFeed items={activity} loading={false} viewAllHref={activityHref} />
            </div>
            <div className="h-full lg:col-span-2">
              <PipelineDonut data={donut} loading={false} currency={defaultCurrency} />
            </div>
          </div>

          <ClosedDealsCard deals={dealsForUser} />
        </>
      )}
    </div>
  )
}
