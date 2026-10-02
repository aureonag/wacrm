"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";

// Workspace of ONE client (loja) inside Operacional → Afiliados: the Aureon
// team operates the client's account from here (campaigns, participants, ...).
const TABS = [
  { slug: "campanhas", key: "campaigns" },
  { slug: "afiliados", key: "affiliates" },
  { slug: "comissoes", key: "commissions" },
  { slug: "notas-fiscais", key: "invoices" },
  { slug: "pagamentos", key: "payments" },
] as const;

type ClientState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; name: string };

export default function AffiliateClientLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.affiliates");
  const { clientId } = useParams<{ clientId: string }>();
  const pathname = usePathname();
  const [state, setState] = useState<ClientState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/operational/affiliates/clients/${clientId}`);
      if (cancelled) return;
      if (res.status === 404) return setState({ kind: "missing" });
      if (!res.ok) return setState({ kind: "error" });
      const data = (await res.json()) as { client: { name: string } };
      setState({ kind: "ready", name: data.client.name });
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (state.kind === "loading") return <Skeleton className="h-24" />;
  if (state.kind === "missing") {
    return <EmptyState title={t("workspace.notFound")} className="min-h-40" />;
  }
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const base = `/operational/afiliados/clientes/${clientId}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{t("workspace.banner", { name: state.name })}</span>
        </div>
        <Link
          href="/operational/afiliados/clientes"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("workspace.allClients")}
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label={state.name}>
        {TABS.map((tab) => {
          const href = `${base}/${tab.slug}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.slug}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`workspace.tabs.${tab.key}`)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
