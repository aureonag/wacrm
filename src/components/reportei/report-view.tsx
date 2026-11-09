// The body of a saved Reportei report (header + one card per ad account with
// the change against the previous period). Shared by the internal page and the
// public share page; each adds its own notes section around it.

import { useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, Megaphone } from 'lucide-react';
import { ClientCode } from '@/components/operational/client-code';
import { formatMetric, showDate, showDateTime } from '@/lib/reportei/format';
import { effectiveOptions } from '@/lib/reportei/template';
import {
  toneFor,
  visibleMetrics,
  variation,
  type ReportSnapshot,
} from '@/lib/reportei/report';
import { ReportChart } from '@/components/reportei/report-chart';
import { cn } from '@/lib/utils';

const TONE = {
  good: 'text-emerald-500',
  bad: 'text-red-500',
  neutral: 'text-muted-foreground',
} as const;

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
  subtitle,
  clientName,
  clientCode,
  createdAt,
  snapshot,
}: {
  title: string;
  subtitle?: string | null;
  clientName: string;
  clientCode?: string | null;
  createdAt: string;
  snapshot: ReportSnapshot;
}) {
  const t = useTranslations('Operational.reportei.reports');
  const tp = useTranslations('Operational.reportei.reportPage');
  const options = effectiveOptions(snapshot.options);

  return (
    <>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {clientCode !== undefined && <ClientCode code={clientCode} />}
          <p className="text-muted-foreground text-sm">{clientName}</p>
        </div>
        <h1 className="text-foreground text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-base">{subtitle}</p>}
        <p className="text-muted-foreground text-sm">
          {t('range', {
            since: showDate(snapshot.period.since),
            until: showDate(snapshot.period.until),
          })}
          {snapshot.compare && (
            <>
              {' · '}
              {tp('comparedWith', {
                since: showDate(snapshot.compare.since),
                until: showDate(snapshot.compare.until),
              })}
            </>
          )}
          {' · '}
          {tp('generatedAt', { date: showDateTime(createdAt) })}
        </p>
      </header>

      {options.intro && (
        <p className="text-foreground whitespace-pre-line text-sm">{options.intro}</p>
      )}

      {snapshot.timeline && snapshot.timeline.length > 0 && (
        <section className="border-border bg-card break-inside-avoid space-y-2 rounded-xl border p-4">
          <h2 className="text-foreground text-sm font-semibold">{tp('milestones')}</h2>
          <ul className="space-y-1.5">
            {snapshot.timeline.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-muted-foreground mr-2 text-xs">{showDate(e.date)}</span>
                <span className="text-foreground font-medium">{e.title}</span>
                {e.description && (
                  <span className="text-muted-foreground block whitespace-pre-line text-xs">{e.description}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.accounts.map((a) => (
          <section
            key={a.id}
            className="border-border bg-card break-inside-avoid rounded-xl border p-4"
          >
            <header className="mb-3 flex items-center gap-2">
              <Megaphone className="text-primary h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-foreground truncate text-sm font-semibold">
                  {a.name}
                </h2>
                <p className="text-muted-foreground truncate text-xs">
                  Meta Ads · {a.id}
                  {a.campaigns
                    ? ` · ${t('campaignsCount', { count: a.campaigns })}`
                    : ''}
                </p>
              </div>
            </header>
            {a.insights ? (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
                  {visibleMetrics(options.metrics, a.insights, a.previous).map((key) => {
                    const current = a.insights![key];
                    const change = a.previous
                      ? variation(current, a.previous[key])
                      : null;
                    const tone = toneFor(key, change);
                    return (
                      <div key={key}>
                        <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">
                          {t(`metric_${key}`)}
                        </dt>
                        <dd className="text-foreground mt-0.5 text-base font-semibold">
                          {formatMetric(key, current, a.currency)}
                        </dd>
                        {snapshot.compare && (
                          <p
                            className={cn(
                              'mt-0.5 flex items-center gap-0.5 text-xs',
                              TONE[tone]
                            )}
                          >
                            {change === null ? (
                              tp('noBase')
                            ) : (
                              <>
                                {change >= 0 ? (
                                  <ArrowUpRight className="h-3 w-3" />
                                ) : (
                                  <ArrowDownRight className="h-3 w-3" />
                                )}
                                {`${change >= 0 ? '+' : '−'}${Math.abs(change).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </dl>
                {options.chart && a.daily && a.daily.length > 1 && (
                  <ReportChart
                    daily={a.daily}
                    previous={a.dailyPrevious}
                    metrics={options.chartMetrics}
                    currency={a.currency}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-red-500">
                {t(`accountError_${a.error ?? 'request_failed'}`)}
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
