"use client";

// "Clientes | Contratos assinados" switch at the top of the Operacional →
// Clientes screens. The first is the operation's own client registry
// (clients → projects → tasks); the second is the old list built from signed
// contracts, kept untouched.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ClientsTabs() {
  const t = useTranslations("Operational.opsClients");
  const pathname = usePathname();
  const onContracts = pathname.startsWith("/operational/clients/contratos");
  const tabs = [
    { href: "/operational/clients", label: t("tabClients"), active: !onContracts },
    { href: "/operational/clients/contratos", label: t("tabContracts"), active: onContracts },
  ];
  return (
    <nav className="flex gap-1 border-b border-border" aria-label={t("title")}>
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
