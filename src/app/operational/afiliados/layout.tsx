"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { EmptyState } from "@/components/dashboard/empty-state";

// Shell for Operacional → Afiliados (admin view of the affiliate SaaS).
// Access is provisional: owner/admin only, matching the server check
// (requireStaff) — see src/lib/affiliates/admin.ts.
const TABS = [
  { href: "/operational/afiliados", key: "overview", exact: true },
  { href: "/operational/afiliados/clientes", key: "clients", exact: false },
] as const;

export default function AffiliatesLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.affiliates");
  const pathname = usePathname();
  const { canManageMembers, profileLoading } = useAuth();

  if (profileLoading) return null;
  if (!canManageMembers) {
    return <EmptyState title={t("noAccessTitle")} hint={t("noAccessHint")} className="min-h-40" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <nav className="flex gap-1 border-b border-border" aria-label={t("title")}>
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
