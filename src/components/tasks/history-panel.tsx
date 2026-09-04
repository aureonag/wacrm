"use client";

import type { TaskActivity } from "@/types";
import { useTranslations } from "next-intl";

// Renders task_activity (populated automatically by DB triggers — see
// 060_task_management_core.sql's log_task_changes()/log_task_created()/
// etc.) as a human-readable feed. No separate task_stage_history render
// here — that table exists for future Etapa 3 analytics (time-in-stage),
// while task_activity already carries a readable "stage_changed" entry
// for the same event.

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryPanel({ activity }: { activity: TaskActivity[] }) {
  const t = useTranslations("Operational.history");

  if (activity.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-3">
      {activity.map((entry) => (
        <div key={entry.id} className="flex gap-2.5">
          <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              <span className="font-medium">{entry.author?.full_name || t("system")}</span>{" "}
              <span className="text-muted-foreground">{entry.title.toLowerCase()}</span>
            </p>
            {entry.detail && <p className="text-xs text-muted-foreground">{entry.detail}</p>}
            <p className="text-[11px] text-muted-foreground/70">{formatDateTime(entry.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
