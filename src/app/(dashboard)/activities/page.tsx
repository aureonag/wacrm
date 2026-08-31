"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadMyNextSteps, type MyNextStep } from "@/lib/pipelines/queries";
import { formatStepDueDate } from "@/lib/deals/next-step-date";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CheckSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

function isOverdue(step: MyNextStep): boolean {
  if (!step.due_date || step.done) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(step.due_date + "T00:00:00").getTime() < today.getTime();
}

export default function ActivitiesPage() {
  const t = useTranslations("Activities");
  const tDetail = useTranslations("Pipelines.detail");
  const locale = useLocale();
  const supabase = createClient();
  const { profile, profileLoading } = useAuth();

  const [steps, setSteps] = useState<MyNextStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (profileLoading) return;
    if (!profile?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    const profileId = profile.id;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadMyNextSteps(supabase, profileId);
      if (cancelled) return;
      setSteps(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileLoading, profile?.id, supabase]);

  async function toggleDone(step: MyNextStep) {
    const done = !step.done;
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, done } : s)));
    await supabase.from("deal_next_steps").update({ done }).eq("id", step.id);
  }

  const visible = showDone ? steps : steps.filter((s) => !s.done);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          {t("showDone")}
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={CheckSquare} title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {visible.map((step) => {
            const overdue = isOverdue(step);
            return (
              <li key={step.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() => toggleDone(step)}
                  className="h-4 w-4 shrink-0 rounded border-border"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {step.title}
                  </p>
                  <Link
                    href={`/pipelines/deals/${step.deal.id}`}
                    className="truncate text-xs text-primary hover:underline"
                  >
                    {step.deal.title}
                  </Link>
                </div>
                {step.due_date && (
                  <span
                    className={`shrink-0 text-xs ${
                      overdue ? "font-medium text-red-400" : "text-muted-foreground"
                    }`}
                  >
                    {formatStepDueDate(step.due_date, locale, tDetail)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
