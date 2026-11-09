"use client";

// Operacional → Reportei → Dashboards: every client with a Meta ad account in one
// table, live, for a period against the previous one. A page of clients at a
// time because each costs a few reads on Meta. A row opens the client's panel.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { summariesToCsv } from "@/lib/reportei/csv";
import { readGoals, type Goals } from "@/lib/reportei/goals";
import { SORT_KEYS, change, overallTotals, sortSummaries, type ClientSummary, type SortKey } from "@/lib/reportei/dashboard";
import { formatInt, formatMetric, showDate } from "@/lib/reportei/format";
import { PERIODS, type Period } from "@/lib/reportei/periods";
import { toneFor } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";
import { GoalBadges } from "../../_components/goal-badges";

interface Page {
  period: { since: string; until: string };
  goals: Record<string, Goals>;
  total: number;
  clients: ClientSummary[];
}

const TONE = { good: "text-emerald-500", bad: "text-red-500", neutral: "text-muted-foreground" } as const;
const PAGE = 10;
const COLUMNS = SORT_KEYS.filter((k) => k !== "name");

function Cell({ row, k }: { row: ClientSummary; k: Exclude<SortKey, "name"> }) {
  const tp = useTranslations("Operational.reportei.dashboardsPage");
  if (!row.totals) return <span className="text-muted-foreground">—</span>;
  const money = k === "spend" || k === "cpc";
  if (money && row.mixedCurrency) return <span className="text-muted-foreground" title={tp("mixedCurrency")}>—</span>;
  const value = row.totals[k];
  const delta = change(row, k);
  const tone = toneFor(k, delta);
  return (
    <>
      <span className="font-medium text-foreground">{k === "clicks" ? formatInt(value) : formatMetric(k, value, row.currency)}</span>
      {delta !== null && (
        <span className={cn("mt-0.5 flex items-center justify-end gap-0.5 text-[11px]", TONE[tone])}>
          {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {`${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
        </span>
      )}
    </>
  );
}

export default function ReporteiDashboardsPage() {
  const t = useTranslations("Operational.reportei.dashboardsPage");
  const tr = useTranslations("Operational.reportei.reports");
  const [period, setPeriod] = useState<Period>("last_30d");
  const [sort, setSort] = useState<SortKey>("spend");
  const [rows, setRows] = useState<ClientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [goals, setGoals] = useState<Record<string, Goals>>({});
  const [range, setRange] = useState<Page["period"] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);
  // Answers that arrive after the period changed must be ignored.
  const run = useRef(0);

  const load = useCallback(async (p: Period, offset: number, refresh: boolean) => {
    const id = ++run.current;
    if (offset === 0) setState("loading");
    else setMore(true);
    try {
      const res = await fetch(`/api/operational/reportei/dashboard?period=${p}&offset=${offset}&limit=${PAGE}${refresh ? "&refresh=1" : ""}`);
      if (id !== run.current) return;
      if (!res.ok) throw new Error("load");
      const page = (await res.json()) as Page;
      setRange(page.period);
      setTotal(page.total);
      setGoals((prev) => (offset === 0 ? page.goals : { ...prev, ...page.goals }));
      setRows((prev) => (offset === 0 ? page.clients : [...prev, ...page.clients]));
      setState("ready");
    } catch {
      if (id === run.current) setState("error");
    } finally {
      if (id === run.current) setMore(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    void load(period, 0, false);
  }, [load, period]);

  const sorted = sortSummaries(rows, sort);
  const overall = overallTotals(rows);

  function exportCsv() {
    const csv = summariesToCsv(sorted, {
      client: t("colClient"),
      code: t("csvCode"),
      accounts: t("csvAccounts"),
      spend: tr("metric_spend"),
      clicks: tr("metric_clicks"),
      ctr: tr("metric_ctr"),
      cpc: tr("metric_cpc"),
      versus: (metric) => t("csvVersus", { metric }),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboards-${period}-${range?.until ?? "export"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

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
        <div className="flex items-center gap-3">
          {range && <p className="text-xs text-muted-foreground">{tr("range", { since: showDate(range.since), until: showDate(range.until) })}</p>}
          <Button variant="outline" size="sm" disabled={state !== "ready" || rows.length === 0} onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("exportCsv")}
          </Button>
          <Button variant="outline" size="sm" disabled={state === "loading" || more} onClick={() => void load(period, 0, true)}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", state === "loading" && "animate-spin")} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {state === "loading" && <Skeleton className="h-64" />}
      {state === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state === "ready" && total === 0 && <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} className="min-h-40" />}

      {state === "ready" && total > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("sortLabel")}>
            <span className="text-xs text-muted-foreground">{t("sortLabel")}</span>
            {SORT_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={sort === k}
                onClick={() => setSort(k)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  sort === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {k === "name" ? t("colClient") : tr(`metric_${k}`)}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t("colClient")}</th>
                  {COLUMNS.map((k) => (
                    <th key={k} className="px-3 py-2.5 text-right font-medium">
                      {tr(`metric_${k}`)}
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((r) => (
                  <tr key={r.clientId} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/operational/reportei/dashboards/${r.clientId}`} className="block">
                        <span className="flex flex-wrap items-center gap-x-1.5 font-medium text-foreground">
                          <ClientCode code={r.code} />
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {r.totals
                            ? t("accountsLine", { readable: r.readable, count: r.accounts })
                            : r.error
                              ? t(`error_${r.error}`)
                              : t("noData")}
                        </span>
                        {range && <GoalBadges reading={readGoals(r, goals[r.clientId], period, range.until)} />}
                      </Link>
                    </td>
                    {COLUMNS.map((k) => (
                      <td key={k} className="px-3 py-3 text-right align-top">
                        <Cell row={r} k={k} />
                      </td>
                    ))}
                    <td className="pr-3">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
              {overall.totals && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/30 text-sm font-medium text-foreground">
                    <td className="px-4 py-3">
                      {t("totalRow")}
                      <span className="block text-xs font-normal text-muted-foreground">{t("totalClients", { count: overall.clients })}</span>
                    </td>
                    {COLUMNS.map((k) => {
                      const money = k === "spend" || k === "cpc";
                      return (
                        <td key={k} className="px-3 py-3 text-right align-top">
                          {money && overall.mixedCurrency ? (
                            <span className="text-muted-foreground" title={t("mixedCurrency")}>—</span>
                          ) : k === "clicks" ? (
                            formatInt(overall.totals![k])
                          ) : (
                            formatMetric(k, overall.totals![k], overall.currency)
                          )}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("loaded", { count: rows.length, total })}</p>
            {rows.length < total && (
              <Button variant="outline" size="sm" disabled={more} onClick={() => void load(period, rows.length, false)}>
                {more && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t("loadMore")}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
