"use client";

import { Workflow } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTranslations } from "next-intl";

// Placeholder only — the real Dashboard Operacional (métricas de tarefas,
// timesheet, handoff...) is ETAPA 3. This etapa just proves the
// environment/permission/route-guard foundation end-to-end.
export default function OperationalDashboardPage() {
  const t = useTranslations("Operational.dashboard");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <EmptyState icon={Workflow} title={t("comingSoonTitle")} hint={t("comingSoonHint")} className="min-h-64" />
    </div>
  );
}
