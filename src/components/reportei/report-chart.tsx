"use client";

// Day-by-day line chart of one ad account in a saved report: pick the metric,
// and when the report compares, the previous period is drawn dashed underneath.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInt, formatMetric, showDate } from "@/lib/reportei/format";
import { DAILY_METRICS, type DailyMetric, type DailyPoint } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";

export function ReportChart({ daily, previous, currency }: { daily: DailyPoint[]; previous?: DailyPoint[]; currency: string | null }) {
  const t = useTranslations("Operational.reportei.reports");
  const tp = useTranslations("Operational.reportei.reportPage");
  const [metric, setMetric] = useState<DailyMetric>("spend");

  const fmt = (v: number) => (metric === "spend" ? formatMetric("spend", v, currency) : formatInt(v));
  // Align the previous period by day number, since its dates are different.
  const data = daily.map((p, i) => ({
    date: p.date,
    value: p[metric],
    previousDate: previous?.[i]?.date,
    previousValue: previous?.[i]?.[metric],
  }));

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="no-print mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={tp("chartMetric")}>
        {DAILY_METRICS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={metric === m}
            onClick={() => setMetric(m)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              metric === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {t(`metric_${m}`)}
          </button>
        ))}
      </div>
      <div className="h-48 w-full text-primary" role="img" aria-label={`${tp("chartTitle")}: ${t(`metric_${metric}`)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" style={{ stroke: "var(--border)" }} />
            <XAxis dataKey="date" tickFormatter={(d: string) => showDate(d).slice(0, 5)} tick={{ fontSize: 10 }} minTickGap={24} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: number) => (metric === "spend" ? String(Math.round(v)) : formatInt(v))} tick={{ fontSize: 10 }} width={48} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(v, name) => [fmt(Number(v)), name === "previousValue" ? tp("chartPrevious") : t(`metric_${metric}`)]}
              labelFormatter={(d) => showDate(String(d))}
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            />
            {previous && <Line dataKey="previousValue" stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            <Line dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {previous && <p className="mt-1 text-[11px] text-muted-foreground">{tp("chartLegend")}</p>}
    </div>
  );
}
