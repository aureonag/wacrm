"use client";

// Reports tab of one client: the numbers of each linked Meta ad account for a
// period (spend, impressions, reach, clicks, CTR, CPC, CPM), read with ads_read.
// First slice of Reportei's report: the data path, before the editable document.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { PERIODS, type Period } from "@/lib/reportei/periods";
import { cn } from "@/lib/utils";

interface Insights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
}

type AccountResult =
  | { id: string; name: string; currency: string | null; insights: Insights }
  | { id: string; name: string; currency: string | null; error: string; detail?: string };

interface Report {
  period: { key: Period; since: string; until: string };
  accounts: AccountResult[];
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; report: Report };

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const showDate = (ymd: string) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));
const num = new Intl.NumberFormat("pt-BR");
const dec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return dec.format(value);
  }
}

export function ReportsPanel({ clientId, hasIntegrations }: { clientId: string; hasIntegrations: boolean }) {
  const t = useTranslations("Operational.reportei.reports");
  const [period, setPeriod] = useState<Period>("last_30d");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/insights?period=${period}`);
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", report: (await res.json()) as Report });
  }, [clientId, period]);

  useEffect(() => {
    if (!hasIntegrations) return;
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, hasIntegrations]);

  if (!hasIntegrations) return <EmptyState title={t("noIntegrationsTitle")} hint={t("noIntegrationsHint")} className="min-h-48" />;

  return (
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
        {state.kind === "ready" && (
          <p className="text-xs text-muted-foreground">{t("range", { since: showDate(state.report.period.since), until: showDate(state.report.period.until) })}</p>
        )}
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
              {"insights" in a ? (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["spend", money(a.insights.spend, a.currency)],
                      ["impressions", num.format(a.insights.impressions)],
                      ["reach", num.format(a.insights.reach)],
                      ["clicks", num.format(a.insights.clicks)],
                      ["ctr", `${dec.format(a.insights.ctr)}%`],
                      ["cpc", money(a.insights.cpc, a.currency)],
                      ["cpm", money(a.insights.cpm, a.currency)],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`metric_${key}`)}</dt>
                      <dd className="mt-0.5 text-base font-semibold text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-red-500">
                  {t(`accountError_${a.error}`)}
                  {a.detail ? <span className="mt-1 block text-xs text-muted-foreground">{a.detail}</span> : null}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
