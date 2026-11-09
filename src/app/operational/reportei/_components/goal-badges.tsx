"use client";

// Small badges for a client's goals: how the month's budget is going and whether
// the CPC is above the goal. Shown on the Dashboards overview and the client panel.

import { useTranslations } from "next-intl";
import type { GoalReading } from "@/lib/reportei/goals";
import { cn } from "@/lib/utils";

const STYLE = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  attention: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  over: "bg-red-500/15 text-red-600 dark:text-red-400",
} as const;

export function GoalBadges({ reading }: { reading: GoalReading }) {
  const t = useTranslations("Operational.reportei.dashboardsPage");
  if (!reading.budget && !reading.cpc) return null;
  const pct = reading.budget ? Math.round(reading.budget.percent) : 0;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {reading.budget && (
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STYLE[reading.budget.status])} title={t("budgetHint", { month: Math.round(reading.budget.monthPercent) })}>
          {t(`budget_${reading.budget.status}`, { percent: pct })}
        </span>
      )}
      {reading.cpc && (
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STYLE[reading.cpc])}>{t(`cpc_${reading.cpc}`)}</span>
      )}
    </span>
  );
}
