"use client";

import { useTranslations } from "next-intl";
import type { TeamRow } from "@/lib/operational-dashboard/queries";
import { formatMinutes } from "@/lib/tasks/timesheet";
import { EmptyState } from "@/components/dashboard/empty-state";

export function TeamTable({ rows }: { rows: TeamRow[] }) {
  const t = useTranslations("Operational.dashboard.team");

  if (rows.length === 0) {
    return <EmptyState title={t("empty")} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">{t("colPerson")}</th>
            <th className="pb-2 font-medium">{t("colAssignedOpen")}</th>
            <th className="pb-2 font-medium">{t("colCompleted")}</th>
            <th className="pb-2 font-medium">{t("colHours")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.profileId} className="border-b border-border/50 last:border-0">
              <td className="py-2 text-foreground">{r.name}</td>
              <td className="py-2 text-foreground">{r.assignedOpen}</td>
              <td className="py-2 text-foreground">{r.completedInPeriod}</td>
              <td className="py-2 text-foreground">{formatMinutes(r.minutesLoggedInPeriod)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
