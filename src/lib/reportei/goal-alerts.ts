// Goal alerts: which warnings a client's month deserves, and the bell notice for
// each. Pure; the daily run (goal-alerts-run.ts) reads Meta and writes them.

import { formatMoney } from "@/lib/reportei/format";
import type { GoalReading } from "@/lib/reportei/goals";

export type AlertKind = "budget_attention" | "budget_over" | "cpc_over";

export interface GoalAlert {
  kind: AlertKind;
  title: string;
  body: string;
}

/** The alerts for one client's current month. Empty when everything is within the goals. */
export function alertsFor(
  reading: GoalReading,
  client: { name: string; currency: string | null },
  goals: { monthlyBudget: number | null; maxCpc: number | null },
  totals: { spend: number; cpc: number },
): GoalAlert[] {
  const out: GoalAlert[] = [];
  const money = (v: number) => formatMoney(v, client.currency);
  if (reading.budget && goals.monthlyBudget !== null) {
    const pct = Math.round(reading.budget.percent);
    const month = Math.round(reading.budget.monthPercent);
    if (reading.budget.status === "over") {
      out.push({ kind: "budget_over", title: `Verba de ${client.name} estourou (${pct}%)`, body: `Gastou ${money(totals.spend)} de ${money(goals.monthlyBudget)} no mês.` });
    } else if (reading.budget.status === "attention") {
      out.push({ kind: "budget_attention", title: `Verba de ${client.name} em ritmo alto (${pct}%)`, body: `Gastou ${money(totals.spend)} de ${money(goals.monthlyBudget)}, com ${month}% do mês passado.` });
    }
  }
  if (reading.cpc === "over" && goals.maxCpc !== null) {
    out.push({ kind: "cpc_over", title: `CPC de ${client.name} acima da meta`, body: `CPC do mês em ${money(totals.cpc)}, meta de ${money(goals.maxCpc)}.` });
  }
  return out;
}

/** "2026-11-15" → "2026-11", the key an alert is deduplicated by. */
export const monthOf = (ymd: string) => ymd.slice(0, 7);
