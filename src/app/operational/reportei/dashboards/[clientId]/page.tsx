"use client";

// The live panel of one client: the same body as a saved report (cards per ad
// account, change against the previous period, day-by-day chart), read from Meta
// now and not saved. "Gerar relatório" freezes it with the period on screen.

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, FilePlus2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ReportView } from "@/components/reportei/report-view";
import { useHasPermission } from "@/hooks/use-permissions";
import { PERIODS, type Period } from "@/lib/reportei/periods";
import type { ReportSnapshot } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";
import { GenerateReportDialog } from "../../_components/generate-report-dialog";

interface Panel {
  client: { id: string; name: string; code: string | null };
  snapshot: ReportSnapshot;
  generatedAt: string;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; panel: Panel };

export default function ReporteiDashboardClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const t = useTranslations("Operational.reportei.dashboardsPage");
  const tr = useTranslations("Operational.reportei.reports");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [period, setPeriod] = useState<Period>("last_30d");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [generating, setGenerating] = useState(false);
  const run = useRef(0);

  const load = useCallback(
    async (p: Period) => {
      const id = ++run.current;
      setState({ kind: "loading" });
      try {
        const res = await fetch(`/api/operational/reportei/dashboard/${clientId}?period=${p}`);
        if (id !== run.current) return;
        if (res.status === 404) return setState({ kind: "notFound" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", panel: (await res.json()) as Panel });
      } catch {
        if (id === run.current) setState({ kind: "error" });
      }
    },
    [clientId],
  );

  useEffect(() => {
    // Fetch for the period on screen; the loading state is the intended first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(period);
  }, [load, period]);

  const back = (
    <Link href="/operational/reportei/dashboards" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      {t("back")}
    </Link>
  );

  if (state.kind === "notFound") {
    return (
      <>
        {back}
        <EmptyState title={t("notFound")} className="min-h-40" />
      </>
    );
  }

  return (
    <>
      {back}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tr("periodLabel")}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                period === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {tr(`period_${p}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={state.kind === "loading"} onClick={() => void load(period)}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", state.kind === "loading" && "animate-spin")} />
            {t("refresh")}
          </Button>
          {canEdit && state.kind === "ready" && (
            <Button size="sm" onClick={() => setGenerating(true)}>
              <FilePlus2 className="mr-1.5 h-4 w-4" />
              {t("generateFromHere")}
            </Button>
          )}
        </div>
      </div>

      {state.kind === "loading" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      )}
      {state.kind === "error" && <EmptyState title={t("panelError")} className="min-h-40" />}
      {state.kind === "ready" && (
        <>
          {state.panel.snapshot.accounts.length === 0 ? (
            <EmptyState title={t("noAccounts")} className="min-h-40" />
          ) : (
            <ReportView
              title={state.panel.client.name}
              clientName={t("liveSubtitle")}
              clientCode={state.panel.client.code}
              createdAt={state.panel.generatedAt}
              snapshot={state.panel.snapshot}
            />
          )}
          {generating && (
            <GenerateReportDialog open={generating} onOpenChange={setGenerating} clientId={clientId} clientName={state.panel.client.name} initialPeriod={period} />
          )}
        </>
      )}
    </>
  );
}
