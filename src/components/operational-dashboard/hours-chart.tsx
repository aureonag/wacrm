"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TimesheetEntry } from "@/types";
import { buildHoursSeries, shiftAnchor, type HoursMode } from "@/lib/operational-dashboard/hours";
import { formatMinutes } from "@/lib/tasks/timesheet";
import { EmptyState } from "@/components/dashboard/empty-state";

/** Hours worked per day, for one week or one month at a time (older ones via the arrows). */
export function HoursChart({ entries }: { entries: TimesheetEntry[] }) {
  const t = useTranslations("Operational.dashboard.hours");
  const locale = useLocale();
  const [mode, setMode] = useState<HoursMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());

  const series = useMemo(() => buildHoursSeries(entries, mode, anchor), [entries, mode, anchor]);

  const label = useMemo(() => {
    if (mode === "month") {
      const s = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(anchor);
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    const fmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
    const [sy, sm, sd] = series.start.split("-").map(Number);
    const [ey, em, ed] = series.end.split("-").map(Number);
    return `${fmt.format(new Date(sy, sm - 1, sd))} – ${fmt.format(new Date(ey, em - 1, ed))}`;
  }, [mode, anchor, locale, series.start, series.end]);

  const data = series.bars.map((b) => {
    const [y, m, d] = b.date.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return {
      key: b.date,
      tick: mode === "week" ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit" }).format(date) : String(d),
      hours: Math.round((b.minutes / 60) * 100) / 100,
      minutes: b.minutes,
    };
  });

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-0.5">
          <button type="button" className={tabClass(mode === "week")} onClick={() => setMode("week")}>
            {t("week")}
          </button>
          <button type="button" className={tabClass(mode === "month")} onClick={() => setMode("month")}>
            {t("month")}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("previous")}
            onClick={() => setAnchor((a) => shiftAnchor(a, mode, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-36 text-center text-sm font-medium text-foreground">{label}</span>
          <button
            type="button"
            aria-label={t("next")}
            onClick={() => setAnchor((a) => shiftAnchor(a, mode, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="ml-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("today")}
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("total")}: <span className="font-semibold text-foreground">{formatMinutes(series.totalMinutes)}</span>
      </p>

      {series.totalMinutes === 0 ? (
        <EmptyState title={t("empty")} className="min-h-40" />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="tick"
                tickLine={false}
                axisLine={false}
                interval={mode === "month" ? 1 : 0}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickFormatter={(v: number) => `${v}h`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
                formatter={(_value, _name, item) => [formatMinutes((item.payload as { minutes: number }).minutes), t("hours")]}
                labelFormatter={(_l, payload) => {
                  const key = (payload?.[0]?.payload as { key?: string } | undefined)?.key;
                  if (!key) return "";
                  const [y, m, d] = key.split("-").map(Number);
                  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long" }).format(new Date(y, m - 1, d));
                }}
              />
              <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
