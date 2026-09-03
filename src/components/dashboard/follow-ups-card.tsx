"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PipelineNextStep } from "@/lib/pipelines/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatTile } from "@/components/dashboard/stat-tile";
import { DealListDialog, type DealListDialogItem } from "@/components/dashboard/deal-list-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { buildFollowUpSummary } from "@/lib/dashboard/queries";
import { CalendarClock } from "lucide-react";

interface FollowUpsCardProps {
  nextSteps: PipelineNextStep[];
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FollowUpsCard({ nextSteps }: FollowUpsCardProps) {
  const t = useTranslations("Dashboard.followUps");
  const [filter, setFilter] = useState<"today" | "overdue" | null>(null);

  const summary = useMemo(() => buildFollowUpSummary(nextSteps), [nextSteps]);
  const today = localDateKey(new Date());

  const dialogItems: DealListDialogItem[] = useMemo(() => {
    if (!filter) return [];
    const pending = nextSteps.filter((s) => !s.done && s.due_date);
    const matching =
      filter === "today"
        ? pending.filter((s) => s.due_date === today)
        : pending.filter((s) => (s.due_date as string) < today);
    return matching.map((s) => ({ id: s.deal.id, title: s.deal.title, meta: s.title }));
  }, [filter, nextSteps, today]);

  const hasAny = summary.dueTodayCount > 0 || summary.overdueCount > 0;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-blue-400" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <EmptyState title={t("none")} />
        ) : (
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                icon={<CalendarClock className="h-4 w-4 text-blue-400" />}
                label={t("today")}
                value={String(summary.dueTodayCount)}
                onClick={summary.dueTodayCount > 0 ? () => setFilter("today") : undefined}
              />
              <StatTile
                icon={<CalendarClock className="h-4 w-4 text-red-400" />}
                label={t("overdue")}
                value={String(summary.overdueCount)}
                onClick={summary.overdueCount > 0 ? () => setFilter("overdue") : undefined}
              />
            </div>
          </TooltipProvider>
        )}
      </CardContent>

      <DealListDialog
        open={filter !== null}
        onOpenChange={(v) => !v && setFilter(null)}
        title={filter === "today" ? t("today") : t("overdue")}
        items={dialogItems}
      />
    </Card>
  );
}
