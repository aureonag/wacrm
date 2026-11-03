"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  ChevronDown,
  FileBarChart,
  FileText,
  LayoutTemplate,
  Plug,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Operacional → Reportei as a cascading submenu of the unified sidebar.
// Same behaviour and row styles as affiliates-nav.tsx (kept in sync by hand;
// sidebar.tsx imports this).
const rowBase = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2";
const rowActive = "bg-primary/10 text-primary";
const subRowBase = "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors lg:py-2";
const rowInactive = "text-muted-foreground hover:bg-muted hover:text-foreground";

const BASE = "/operational/reportei";

const ADMIN_SECTIONS = [
  { slug: "clientes", key: "clients", icon: Building2 },
  { slug: "integracoes", key: "integrations", icon: Plug },
] as const;

const OPERATION_SECTIONS = [
  { slug: "relatorios", key: "reports", icon: FileText },
  { slug: "automacoes", key: "automations", icon: Repeat },
  { slug: "templates", key: "templates", icon: LayoutTemplate },
] as const;

export function ReporteiNav() {
  const t = useTranslations("Operational.reportei");
  const pathname = usePathname();
  const inModule = pathname.startsWith(BASE);
  const [open, setOpen] = useState(inModule);

  useEffect(() => {
    // Opens by itself when the route enters the module (like Afiliados).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inModule) setOpen(true);
  }, [inModule]);

  const label = (text: string) => (
    <li className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{text}</li>
  );

  const link = ({ slug, key, icon: Icon }: { slug: string; key: string; icon: typeof Building2 }) => (
    <li key={slug}>
      <Link
        prefetch={false}
        href={`${BASE}/${slug}`}
        className={cn(subRowBase, pathname.startsWith(`${BASE}/${slug}`) ? rowActive : rowInactive)}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{t(`nav.${key}`)}</span>
      </Link>
    </li>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(rowBase, "w-full", inModule ? rowActive : rowInactive)}
      >
        <FileBarChart className="h-4 w-4" />
        <span className="flex-1 text-left">{t("nav.title")}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open ? "rotate-0" : "-rotate-90")} />
      </button>

      {open && (
        <ul className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-border pl-2">
          {label(t("nav.administration"))}
          {ADMIN_SECTIONS.map(link)}
          {label(t("nav.operation"))}
          {OPERATION_SECTIONS.map(link)}
        </ul>
      )}
    </>
  );
}
