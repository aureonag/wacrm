"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadPipelines, loadPipelineStages, loadPipelineDeals } from "@/lib/pipelines/queries";
import { buildPipelineActivity } from "@/lib/dashboard/queries";
import { getPeriodRange, type DateRange, type PeriodKind } from "@/lib/dashboard/period";
import type { Deal, Pipeline, PipelineStage } from "@/types";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export default function DashboardActivityPage() {
  return (
    <Suspense fallback={null}>
      <DashboardActivityPageInner />
    </Suspense>
  );
}

function DashboardActivityPageInner() {
  const t = useTranslations("Dashboard.activityPage");
  const tActivity = useTranslations("Dashboard.activityFeed");
  const searchParams = useSearchParams();
  const pipelineId = searchParams.get("pipeline") ?? "";
  const initialPeriod = (searchParams.get("period") as PeriodKind | null) ?? "month";

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodKind, setPeriodKind] = useState<PeriodKind>(initialPeriod);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!pipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    const db = createClient();
    (async () => {
      const [pipelineList, s, d] = await Promise.all([
        loadPipelines(db),
        loadPipelineStages(db, pipelineId),
        loadPipelineDeals(db, pipelineId),
      ]);
      if (cancelled) return;
      setPipelines(pipelineList);
      setStages(s);
      setDeals(d);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  const periodRange = useMemo(
    () => getPeriodRange(periodKind, customRange ?? undefined),
    [periodKind, customRange],
  );

  const allItems = useMemo(
    () =>
      buildPipelineActivity(
        stages,
        deals,
        undefined,
        {
          inStage: (title, stage) => tActivity("dealInStage", { title, stage }),
          updated: (title) => tActivity("dealUpdated", { title }),
        },
        periodRange,
      ),
    [stages, deals, periodRange, tActivity],
  );

  const totalCount = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const visible = allItems.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  const pipelineName = pipelines.find((p) => p.id === pipelineId)?.name;

  const handlePeriodChange = (kind: PeriodKind, custom?: DateRange) => {
    setPeriodKind(kind);
    setCustomRange(custom ?? null);
    setPage(0);
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-96 w-full animate-pulse rounded-xl bg-muted/50" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">
          {pipelineName ? t("titleFor", { pipeline: pipelineName }) : t("title")}
        </h1>
      </div>

      <PeriodFilter kind={periodKind} custom={customRange} onChange={handlePeriodChange} />

      <section className="rounded-xl border border-border bg-card">
        {visible.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Inbox} title={tActivity("noActivity")} hint={tActivity("noActivityHint")} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((it) => (
              <li key={it.id} className="transition-colors hover:bg-muted/40">
                {it.href ? (
                  <Link href={it.href} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{it.text}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {new Date(it.at).toLocaleString()}
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{it.text}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {new Date(it.at).toLocaleString()}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted-foreground">
              {t("showingPagination", {
                start: clampedPage * PAGE_SIZE + 1,
                end: Math.min((clampedPage + 1) * PAGE_SIZE, totalCount),
                total: totalCount,
              })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={clampedPage === 0}
                onClick={() => setPage((p) => p - 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-xs text-muted-foreground">
                {t("pageCount", { page: clampedPage + 1, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
