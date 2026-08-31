"use client";

import { Loader2, CheckCircle2, XCircle, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProspectingRunSnapshot } from "@/hooks/use-prospecting-run-polling";

const IN_PROGRESS_STATUSES = new Set(["queued", "searching", "enriching", "scoring", "importing"]);

export function ProspectingRunProgress({ run }: { run: ProspectingRunSnapshot }) {
  const t = useTranslations("Prospecting.runStatus");

  const inProgress = IN_PROGRESS_STATUSES.has(run.status);
  const failed = run.status === "failed";
  const done = run.status === "completed" || run.status === "partially_completed";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        {inProgress && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        {failed && <XCircle className="h-3.5 w-3.5 text-destructive" />}
        {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
        {run.status === "awaiting_review" && <Search className="h-3.5 w-3.5 text-primary" />}
        {t(run.status)}
      </span>
      <span className="text-muted-foreground">
        {t("foundCount", { count: run.found_count })} · {t("validatedCount", { count: run.validated_count })} ·{" "}
        {t("duplicateCount", { count: run.duplicate_count })}
        {run.imported_count > 0 && <> · {t("importedCount", { count: run.imported_count })}</>}
      </span>
      {failed && run.error && <span className="text-destructive">{run.error}</span>}
    </div>
  );
}
