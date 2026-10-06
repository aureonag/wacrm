"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Building2,
  ChevronDown,
  Code2,
  FileText,
  Flag,
  Gift,
  LayoutDashboard,
  Plug,
  UsersRound,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectedClientId } from "@/app/operational/afiliados/_components/selected-client";

// Operacional → Afiliados as a cascading submenu of the unified sidebar.
// Sections that belong to one client (Dashboard … Integrações) always open on
// the client currently selected in the context bar (URL first, then the last
// one remembered); without one they send the team to "Contas de clientes".
// Same row styles as sidebar.tsx (kept in sync by hand; sidebar.tsx imports this).
const rowBase = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2";
const rowActive = "bg-primary/10 text-primary";
// The nested rows are a bit tighter so "Contas de clientes" fits on one line.
const subRowBase = "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors lg:py-2";
const rowInactive = "text-muted-foreground hover:bg-muted hover:text-foreground";

const BASE = "/operational/afiliados";

const CLIENT_SECTIONS = [
  { slug: "dashboard", key: "dashboard", icon: LayoutDashboard },
  { slug: "campanhas", key: "campaigns", icon: Flag },
  { slug: "afiliados", key: "affiliates", icon: Users },
  { slug: "comissoes", key: "commissions", icon: Gift },
  { slug: "notas-fiscais", key: "invoices", icon: FileText },
  { slug: "pagamentos", key: "payments", icon: Wallet },
  { slug: "relatorios", key: "reports", icon: Activity },
  { slug: "integracoes", key: "integrations", icon: Plug },
] as const;

export function AffiliatesNav() {
  const t = useTranslations("Operational.affiliates");
  const pathname = usePathname();
  const clientId = useSelectedClientId();
  const inModule = pathname.startsWith(BASE);
  const [open, setOpen] = useState(inModule);

  useEffect(() => {
    // Opens by itself when the route enters the module (like the sections above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inModule) setOpen(true);
  }, [inModule]);

  // /operational/afiliados/clientes/:id/:section/... → segs[5] is the section.
  const segs = pathname.split("/");
  const activeSection = pathname.startsWith(`${BASE}/clientes/`) ? segs[5] : undefined;
  const onClientsList = pathname === `${BASE}/clientes`;

  const label = (text: string) => (
    <li className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{text}</li>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(rowBase, "w-full", inModule ? rowActive : rowInactive)}
      >
        <UsersRound className="h-4 w-4" />
        <span className="flex-1 text-left">{t("nav.title")}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open ? "rotate-0" : "-rotate-90")} />
      </button>

      {open && (
        <ul className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-border pl-2">
          {label(t("nav.administration"))}
          <li>
            <Link href={`${BASE}/clientes`} className={cn(subRowBase, onClientsList ? rowActive : rowInactive)}>
              <Building2 className="h-4 w-4" />
              <span className="flex-1">{t("nav.clients")}</span>
            </Link>
          </li>

          {label(t("nav.operation"))}
          {CLIENT_SECTIONS.map(({ slug, key, icon: Icon }) => (
            <li key={slug}>
              <Link
                href={clientId ? `${BASE}/clientes/${clientId}/${slug}` : `${BASE}/clientes`}
                className={cn(subRowBase, activeSection === slug ? rowActive : rowInactive)}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{t(`nav.${key}`)}</span>
              </Link>
            </li>
          ))}

          {label(t("nav.system"))}
          <li>
            <Link
              href={`${BASE}/desenvolvimento`}
              className={cn(subRowBase, pathname.startsWith(`${BASE}/desenvolvimento`) ? rowActive : rowInactive)}
            >
              <Code2 className="h-4 w-4" />
              <span className="flex-1">{t("nav.development")}</span>
            </Link>
          </li>
        </ul>
      )}
    </>
  );
}
