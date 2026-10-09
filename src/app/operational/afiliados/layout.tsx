"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { EmptyState } from "@/components/dashboard/empty-state";

// Shell for Operacional → Afiliados (admin view of the affiliate SaaS). The
// sections are in the sidebar submenu; each page draws its own heading.
// Access: owner/admin, or whoever has the "Acessar Afiliados" permission,
// matching the server check (requireStaff) — see src/lib/affiliates/admin.ts.
export default function AffiliatesLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.affiliates");
  const { canManageMembers, permissions, profileLoading } = useAuth();
  const allowed = canManageMembers || permissions.has("operational:affiliates:access");

  if (profileLoading) return null;
  if (!allowed) {
    return <EmptyState title={t("noAccessTitle")} hint={t("noAccessHint")} className="min-h-40" />;
  }

  return <div className="space-y-5">{children}</div>;
}
