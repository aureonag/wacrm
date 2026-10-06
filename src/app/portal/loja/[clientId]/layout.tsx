"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowLeft,
  Flag,
  Gift,
  FileText,
  LayoutDashboard,
  LogOut,
  Plug,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { can, type StoreModule, type StorePermissions } from "@/lib/affiliates/store-access";
import { WorkspaceProvider } from "@/app/operational/afiliados/_components/workspace";

// Portal da loja: the people of a store (owner, manager, finance, viewer) see
// the SAME screens as the Aureon team, scoped to their own store and to what
// their role / overrides allow. Aureon staff can open it with "Ver como
// cliente" (a banner says so).

interface Session {
  kind: "portal" | "staff";
  name: string | null;
  is_affiliate: boolean;
  stores: { client_id: string; client_name: string; role: string; permissions: StorePermissions }[];
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; session: Session };

// Section → permission needed to SEE it in the menu (null = everyone of the store).
const SECTIONS: { slug: string; key: string; icon: typeof Users; module: StoreModule | null }[] = [
  { slug: "dashboard", key: "dashboard", icon: LayoutDashboard, module: null },
  { slug: "campanhas", key: "campaigns", icon: Flag, module: "campaigns" },
  { slug: "afiliados", key: "affiliates", icon: Users, module: "affiliates" },
  { slug: "comissoes", key: "commissions", icon: Gift, module: "commissions" },
  { slug: "notas-fiscais", key: "invoices", icon: FileText, module: "invoices" },
  { slug: "pagamentos", key: "payments", icon: Wallet, module: "payments" },
  { slug: "relatorios", key: "reports", icon: Activity, module: "reports" },
  { slug: "integracoes", key: "integrations", icon: Plug, module: "integrations" },
  { slug: "equipe", key: "team", icon: UsersRound, module: "team" },
];

const HEADING_KEY: Record<string, string> = {
  dashboard: "dashboard",
  campanhas: "campaigns",
  afiliados: "affiliates",
  comissoes: "commissions",
  "notas-fiscais": "invoices",
  pagamentos: "payments",
  relatorios: "reports",
  integracoes: "integrations",
  equipe: "team",
};

export default function StorePortalLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.affiliates");
  const tp = useTranslations("Portal.store");
  const { clientId } = useParams<{ clientId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/portal/store/me?client=${clientId}`);
      if (cancelled) return;
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", session: (await res.json()) as Session });
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/portal/entrar");
  }

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const store = state.kind === "ready" ? state.session.stores.find((s) => s.client_id === clientId) : undefined;
  if (state.kind === "error" || !store) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <EmptyState title={tp("noAccessTitle")} hint={tp("noAccessHint")} className="min-h-40" />
        <Link href="/portal" className="text-sm font-medium text-primary hover:underline">
          {tp("backToPortal")}
        </Link>
      </div>
    );
  }

  const session = (state as { kind: "ready"; session: Session }).session;
  const base = `/portal/loja/${clientId}`;
  const rest = pathname.split(`${base}`)[1]?.split("/").filter(Boolean) ?? [];
  const section = rest[0] ?? "dashboard";
  const showHeading = rest.length <= 1 && HEADING_KEY[section] !== undefined;
  const visible = SECTIONS.filter((s) => s.module === null || can(store.permissions, s.module, "view"));
  const isStaff = session.kind === "staff";

  const nav = (
    <ul className="flex gap-1 lg:flex-col">
      {visible.map(({ slug, key, icon: Icon }) => {
        const active = section === slug;
        return (
          <li key={slug} className="shrink-0">
            <Link
              href={`${base}/${slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(`nav.${key}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <WorkspaceProvider clientId={clientId} pageBase={base} permissions={store.permissions}>
      <div className="min-h-screen bg-background lg:flex">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 lg:flex">
          <div className="flex h-14 items-center border-b border-border px-5">
            <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-6 w-auto" />
            <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-6 w-auto" />
          </div>
          <p className="px-5 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {tp("menuLabel")}
          </p>
          <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={store.client_name}>
            {nav}
          </nav>
          {!isStaff && (
            <div className="border-t border-border p-3">
              <p className="truncate px-2 text-sm font-medium text-foreground">{session.name ?? ""}</p>
              <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{tp(`role_${store.role}`)}</p>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                {tp("signOut")}
              </Button>
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 lg:px-6">
            <strong className="truncate text-base font-semibold text-foreground">{store.client_name}</strong>
            <div className="flex items-center gap-2">
              {session.stores.length > 1 && (
                <Select value={clientId} onValueChange={(v) => v && router.push(`/portal/loja/${v}/dashboard`)}>
                  <SelectTrigger aria-label={tp("selectStore")} className="h-9 w-48">
                    <SelectValue>{store.client_name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {session.stores.map((s) => (
                      <SelectItem key={s.client_id} value={s.client_id}>
                        {s.client_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!isStaff && (
                <Button variant="ghost" size="sm" className="lg:hidden" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  <span className="sr-only">{tp("signOut")}</span>
                </Button>
              )}
            </div>
          </header>

          <nav className="overflow-x-auto border-b border-border px-3 py-2 lg:hidden" aria-label={store.client_name}>
            {nav}
          </nav>

          <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 lg:px-6">
            {isStaff && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
                <span className="inline-flex items-center gap-2 text-sm text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  {tp("viewingAs", { name: store.client_name })}
                </span>
                <Link
                  href={`/operational/afiliados/clientes/${clientId}/dashboard`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {tp("backToAdmin")}
                </Link>
              </div>
            )}

            {showHeading && (
              <div>
                <h1 className="text-2xl font-bold text-foreground">{t(`headings.${HEADING_KEY[section]}.title`)}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t(`headings.${HEADING_KEY[section]}.description`)}</p>
              </div>
            )}

            {children}
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
