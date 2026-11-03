"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { useHasPermission } from "@/hooks/use-permissions";
import { EmptyState } from "@/components/dashboard/empty-state";

// Shell for Operacional → Reportei (internal client reporting). The sections
// are in the sidebar submenu; each page draws its own heading. Same audience
// as the sidebar entry: whoever can see Operacional (no permission of its own).
export default function ReporteiLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.reportei");
  const { profileLoading } = useAuth();
  const allowed = useHasPermission("operational", "tasks", "view_boards");

  if (profileLoading) return null;
  if (!allowed) {
    return <EmptyState title={t("noAccessTitle")} hint={t("noAccessHint")} className="min-h-40" />;
  }

  return <div className="space-y-5">{children}</div>;
}
