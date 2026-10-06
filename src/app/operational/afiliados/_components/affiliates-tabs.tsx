"use client";

// "Participantes | Ranking" switch shown at the top of the Afiliados screens.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace";

export function AffiliatesTabs() {
  const t = useTranslations("Operational.affiliates");
  const { pageBase } = useWorkspace();
  const pathname = usePathname();
  const tabs = [
    { href: `${pageBase}/afiliados`, label: t("members.tabParticipants"), active: !pathname.endsWith("/ranking") },
    { href: `${pageBase}/afiliados/ranking`, label: t("members.tabRanking"), active: pathname.endsWith("/ranking") },
  ];
  return (
    <nav className="flex gap-1 border-b border-border" aria-label={t("headings.affiliates.title")}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
