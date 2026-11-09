"use client";

// "Melhore seu projeto com 3 passos" of the Reportei client home: link the ad
// accounts, generate the first report, automate it. Shown until all three are
// done; each step takes you to the tab where it is done.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChecklistTab = "integrations" | "reports" | "automations";

export function ClientChecklist({ clientId, integrations, onGo }: { clientId: string; integrations: number; onGo: (tab: ChecklistTab) => void }) {
  const t = useTranslations("Operational.reportei.checklist");
  const [hasReport, setHasReport] = useState<boolean | null>(null);
  const [hasAutomation, setHasAutomation] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/operational/reportei/reports?clientId=${clientId}`)
      .then(async (res) => alive && setHasReport(res.ok ? ((await res.json()) as { reports: unknown[] }).reports.length > 0 : false))
      .catch(() => alive && setHasReport(false));
    fetch(`/api/operational/reportei/clients/${clientId}/automation`)
      .then(async (res) => alive && setHasAutomation(res.ok ? ((await res.json()) as { automation: unknown | null }).automation !== null : false))
      .catch(() => alive && setHasAutomation(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  // Wait for both answers before drawing, so the box never flashes in and out.
  if (hasReport === null || hasAutomation === null) return null;

  const steps: { key: ChecklistTab; done: boolean }[] = [
    { key: "integrations", done: integrations > 0 },
    { key: "reports", done: hasReport },
    { key: "automations", done: hasAutomation },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      <ol className="mt-2 space-y-1">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onGo(s.key)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50", s.done ? "text-muted-foreground" : "text-foreground")}
            >
              {s.done ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className={cn(s.done && "line-through")}>{t(`step_${i + 1}`)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
