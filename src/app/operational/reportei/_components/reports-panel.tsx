"use client";

// Reports tab of one client: the live numbers of each linked Meta ad account for
// a period (read with ads_read), the "Gerar relatório" button that freezes them
// into a saved report, and the client's saved reports.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, FileText, Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useHasPermission } from "@/hooks/use-permissions";
import { formatMetric, showDate, showDateTime } from "@/lib/reportei/format";
import { PERIODS, type Period } from "@/lib/reportei/periods";
import { METRICS, type AccountSnapshot } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";
import { GenerateReportDialog } from "./generate-report-dialog";

interface Report {
  period: { key: Period; since: string; until: string };
  accounts: AccountSnapshot[];
}

interface SavedReport {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  compared: boolean;
  auto: boolean;
  createdAt: string;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; report: Report };

export function ReportsPanel({ clientId, clientName, hasIntegrations }: { clientId: string; clientName: string; hasIntegrations: boolean }) {
  const t = useTranslations("Operational.reportei.reports");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [period, setPeriod] = useState<Period>("last_30d");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saved, setSaved] = useState<SavedReport[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/insights?period=${period}`);
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", report: (await res.json()) as Report });
  }, [clientId, period]);

  const loadSaved = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/reports?clientId=${clientId}`);
    setSaved(res.ok ? ((await res.json()) as { reports: SavedReport[] }).reports : []);
  }, [clientId]);

  useEffect(() => {
    if (!hasIntegrations) return;
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, hasIntegrations]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSaved();
  }, [loadSaved]);

  if (!hasIntegrations) return <EmptyState title={t("noIntegrationsTitle")} hint={t("noIntegrationsHint")} className="min-h-48" />;

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("periodLabel")}>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => {
                  setPeriod(p);
                  setState({ kind: "loading" });
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {t(`period_${p}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {state.kind === "ready" && (
              <p className="text-xs text-muted-foreground">{t("range", { since: showDate(state.report.period.since), until: showDate(state.report.period.until) })}</p>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setGenerating(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t("generate")}
              </Button>
            )}
          </div>
        </div>

        {state.kind === "loading" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        )}
        {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
        {state.kind === "ready" && (
          <div className="grid gap-4 md:grid-cols-2">
            {state.report.accounts.map((a) => (
              <section key={a.id} className="rounded-xl border border-border bg-card p-4">
                <header className="mb-3 flex items-center gap-2">
                  <Megaphone className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground">{a.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">Meta Ads · {a.id}</p>
                  </div>
                </header>
                {a.insights ? (
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {METRICS.map((key) => (
                      <div key={key}>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`metric_${key}`)}</dt>
                        <dd className="mt-0.5 text-base font-semibold text-foreground">{formatMetric(key, a.insights![key], a.currency)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-red-500">
                    {t(`accountError_${a.error ?? "request_failed"}`)}
                    {a.detail ? <span className="mt-1 block text-xs text-muted-foreground">{a.detail}</span> : null}
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("savedTitle")}</h2>
        {saved === null ? (
          <Skeleton className="h-16" />
        ) : saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("savedEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {saved.map((r) => (
              <li key={r.id}>
                <Link href={`/operational/reportei/relatorios/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="truncate">{r.title}</span>
                      {r.auto && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{t("autoBadge")}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("range", { since: showDate(r.periodStart), until: showDate(r.periodEnd) })} · {showDateTime(r.createdAt)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <GenerateReportDialog open={generating} onOpenChange={setGenerating} clientId={clientId} clientName={clientName} />
    </div>
  );
}
