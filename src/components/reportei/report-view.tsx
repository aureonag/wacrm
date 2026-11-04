// The body of a saved Reportei report (header + one card per ad account with
// the change against the previous period). Shared by the internal page and the
// public share page; each adds its own notes section around it.

import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, Megaphone } from "lucide-react";
import { ClientCode } from "@/components/operational/client-code";
import { formatMetric, showDate, showDateTime } from "@/lib/reportei/format";
import { METRICS, toneFor, variation, type ReportSnapshot } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";

const TONE = { good: "text-emerald-500", bad: "text-red-500", neutral: "text-muted-foreground" } as const;

// Print only the report: hide the app chrome, force a light page.
export const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  #report-print, #report-print * { visibility: visible; }
  #report-print { position: absolute; left: 0; top: 0; width: 100%; color: #111; background: #fff;
    --foreground: #111; --card: #fff; --background: #fff; --muted-foreground: #555; --border: #ddd; }
  html, body, div.h-screen, main { height: auto !important; overflow: visible !important; background: #fff !important; }
  .no-print { display: none !important; }
}`;

export function ReportView({
  title,
  clientName,
  clientCode,
  createdAt,
  snapshot,
}: {
  title: string;
  clientName: string;
  clientCode?: string | null;
  createdAt: string;
  snapshot: ReportSnapshot;
}) {
  const t = useTranslations("Operational.reportei.reports");
  const tp = useTranslations("Operational.reportei.reportPage");

  return (
    <>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {clientCode !== undefined && <ClientCode code={clientCode} />}
          <p className="text-sm text-muted-foreground">{clientName}</p>
        </div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {t("range", { since: showDate(snapshot.period.since), until: showDate(snapshot.period.until) })}
          {snapshot.compare && (
            <>
              {" · "}
              {tp("comparedWith", { since: showDate(snapshot.compare.since), until: showDate(snapshot.compare.until) })}
            </>
          )}
          {" · "}
          {tp("generatedAt", { date: showDateTime(createdAt) })}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.accounts.map((a) => (
          <section key={a.id} className="break-inside-avoid rounded-xl border border-border bg-card p-4">
            <header className="mb-3 flex items-center gap-2">
              <Megaphone className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">{a.name}</h2>
                <p className="truncate text-xs text-muted-foreground">Meta Ads · {a.id}</p>
              </div>
            </header>
            {a.insights ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
                {METRICS.map((key) => {
                  const current = a.insights![key];
                  const change = a.previous ? variation(current, a.previous[key]) : null;
                  const tone = toneFor(key, change);
                  return (
                    <div key={key}>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`metric_${key}`)}</dt>
                      <dd className="mt-0.5 text-base font-semibold text-foreground">{formatMetric(key, current, a.currency)}</dd>
                      {snapshot.compare && (
                        <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs", TONE[tone])}>
                          {change === null ? (
                            tp("noBase")
                          ) : (
                            <>
                              {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {`${change >= 0 ? "+" : "−"}${Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-sm text-red-500">{t(`accountError_${a.error ?? "request_failed"}`)}</p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
