"use client";

// The goals of one client (monthly budget and maximum CPC), shown on the live
// panel, with the badges for the numbers on screen. Whoever can edit boards can
// change them; saving both empty removes the goals.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHasPermission } from "@/hooks/use-permissions";
import { readGoals, type Goals } from "@/lib/reportei/goals";
import { summarizeClient } from "@/lib/reportei/dashboard";
import { formatMoney } from "@/lib/reportei/format";
import type { AccountSnapshot } from "@/lib/reportei/report";
import { GoalBadges } from "./goal-badges";

const show = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

export function GoalsCard({
  clientId,
  initial,
  accounts,
  periodKey,
  today,
}: {
  clientId: string;
  initial: Goals;
  accounts: AccountSnapshot[];
  periodKey: string;
  today: string;
}) {
  const t = useTranslations("Operational.reportei.dashboardsPage");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [goals, setGoals] = useState<Goals>(initial);
  const [budget, setBudget] = useState(show(initial.monthlyBudget));
  const [cpc, setCpc] = useState(show(initial.maxCpc));
  const [saving, setSaving] = useState(false);

  const summary = summarizeClient({ clientId, name: "", code: null }, accounts);
  const reading = readGoals(summary, goals, periodKey, today);
  const dirty = budget !== show(goals.monthlyBudget) || cpc !== show(goals.maxCpc);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/goals`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudget: budget, maxCpc: cpc }),
      });
      if (res.status === 400) return toast.error(t("goalsInvalid"));
      if (!res.ok) return toast.error(t("goalsSaveError"));
      const { goals: saved } = (await res.json()) as { goals: Goals };
      setGoals(saved);
      setBudget(show(saved.monthlyBudget));
      setCpc(show(saved.maxCpc));
      toast.success(t("goalsSaved"));
    } catch {
      toast.error(t("goalsSaveError"));
    } finally {
      setSaving(false);
    }
  }

  const money = (v: number | null) => (v === null ? t("goalNone") : formatMoney(v, summary.currency));

  return (
    <section className="no-print space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <Target className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{t("goalsTitle")}</h2>
        <GoalBadges reading={reading} />
      </header>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("goalBudget")}</span>
            <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t("goalPlaceholder")} className="w-40" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("goalMaxCpc")}</span>
            <Input inputMode="decimal" value={cpc} onChange={(e) => setCpc(e.target.value)} placeholder={t("goalPlaceholder")} className="w-40" />
          </label>
          <Button size="sm" disabled={saving || !dirty} onClick={save}>
            {t("goalsSave")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("goalBudget")}: {money(goals.monthlyBudget)} · {t("goalMaxCpc")}: {money(goals.maxCpc)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{summary.mixedCurrency ? t("goalsMixed") : t("goalsHint")}</p>
    </section>
  );
}
