"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { rememberClient } from "../../_components/selected-client";
import { useAffiliateClients } from "../../_components/use-affiliate-clients";

// Workspace of ONE client (loja) inside Operacional → Afiliados: the Aureon
// team operates the client's account from here. The sections live in the
// sidebar submenu; this layout shows which account is selected (and lets the
// team switch it) plus the heading of the current section.
const SECTIONS = ["dashboard", "campanhas", "afiliados", "comissoes", "notas-fiscais", "pagamentos", "relatorios", "integracoes"] as const;
type Section = (typeof SECTIONS)[number];

const HEADING_KEY: Record<Section, string> = {
  dashboard: "dashboard",
  campanhas: "campaigns",
  afiliados: "affiliates",
  comissoes: "commissions",
  "notas-fiscais": "invoices",
  pagamentos: "payments",
  relatorios: "reports",
  integracoes: "integrations",
};

export default function AffiliateClientLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operational.affiliates");
  const { clientId } = useParams<{ clientId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useAffiliateClients();

  const rest = pathname.split(`/clientes/${clientId}`)[1]?.split("/").filter(Boolean) ?? [];
  const section = (SECTIONS as readonly string[]).includes(rest[0]) ? (rest[0] as Section) : null;
  // The campaign editor (campanhas/nova, campanhas/:id) draws its own heading.
  const showHeading = section !== null && rest.length === 1;

  const known = state.kind === "ready" && state.clients.some((c) => c.id === clientId);
  useEffect(() => {
    if (known) rememberClient(clientId);
  }, [known, clientId]);

  if (state.kind === "loading") return <Skeleton className="h-24" />;
  if (state.kind === "not_ready") return <EmptyState title={t("notReadyTitle")} hint={t("notReadyHint")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;
  if (!known) return <EmptyState title={t("workspace.notFound")} className="min-h-40" />;

  const current = state.clients.find((c) => c.id === clientId)!;

  function switchClient(nextId: string | null) {
    if (!nextId || nextId === clientId) return;
    // Same section on the other account; editor pages fall back to the list.
    router.push(`/operational/afiliados/clientes/${nextId}/${section ?? "dashboard"}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-primary">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("workspace.contextBar")}</span>
        </div>
        <Select value={clientId} onValueChange={switchClient}>
          <SelectTrigger aria-label={t("workspace.selectClient")} className="h-9 w-full min-w-56 sm:w-64">
            <SelectValue>{current.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {state.clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.status === "suspended" ? ` · ${t("clients.suspended")}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showHeading && section && (
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t(`headings.${HEADING_KEY[section]}.title`)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(`headings.${HEADING_KEY[section]}.description`)}</p>
        </div>
      )}

      {children}
    </div>
  );
}
