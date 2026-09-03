"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatTile } from "@/components/dashboard/stat-tile";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
  /** When set, the won/lost cards count by `closed_at` within this range
   *  instead of the current calendar month — used by the dashboard's
   *  period filter. Omitted on the Pipelines board, which keeps the
   *  original "this month" behaviour. */
  periodRange?: { start: Date; end: Date };
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals, periodRange }: PipelineAnalyticsProps) {
  const t = useTranslations("Pipelines.analytics");
  const { defaultCurrency } = useAuth();
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + Number(d.value || 0) * prob;
    }, 0);

    // Without a periodRange (the Pipelines board's plain usage), keep the
    // original "this calendar month" reading, approximated from
    // updated_at since older deals predate the closed_at column. With a
    // periodRange (the dashboard's period filter), count by the precise
    // closed_at the migration 040 trigger stamps on the won/lost
    // transition — accurate regardless of later unrelated edits.
    const inWindow = (d: Deal) => {
      if (periodRange) {
        if (!d.closed_at) return false;
        const t = new Date(d.closed_at).getTime();
        return t >= periodRange.start.getTime() && t <= periodRange.end.getTime();
      }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const ts = d.closed_at ?? d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonInWindow = deals.filter((d) => d.status === "won" && inWindow(d)).length;
    const lostInWindow = deals.filter((d) => d.status === "lost" && inWindow(d)).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonInWindow,
      lostInWindow,
    };
  }, [deals, sortedStages, periodRange]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label={t("totalDeals")}
          value={String(stats.totalCount)}
          tooltip={t("totalDealsTooltip")}
        />
        <StatTile
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          label={t("pipelineValue")}
          value={formatCurrency(stats.totalValue, defaultCurrency)}
          tooltip={t("pipelineValueTooltip")}
        />
        <StatTile
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label={t("avgDealSize")}
          value={formatCurrency(stats.avgValue, defaultCurrency)}
          tooltip={t("avgDealSizeTooltip")}
        />
        <StatTile
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          label={t("weightedValue")}
          value={formatCurrency(stats.weightedValue, defaultCurrency)}
          tooltip={t("weightedValueTooltip")}
        />
        <StatTile
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label={periodRange ? t("wonInPeriod") : t("wonThisMonth")}
          value={String(stats.wonInWindow)}
          tooltip={periodRange ? t("wonInPeriodTooltip") : t("wonThisMonthTooltip")}
        />
        <StatTile
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label={periodRange ? t("lostInPeriod") : t("lostThisMonth")}
          value={String(stats.lostInWindow)}
          tooltip={periodRange ? t("lostInPeriodTooltip") : t("lostThisMonthTooltip")}
        />
      </div>
    </TooltipProvider>
  );
}
