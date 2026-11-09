"use client";

// Operacional → Reportei → Clientes: the clients of the operation (ops_clients) as
// cards, like Reportei's: photo with a connection-health badge, name, the networks
// linked, how many reports and when the last one was made. Click a card to open
// the client's Reportei page. "Novo cliente" opens the two-step wizard (preferences,
// then integrations); it creates the same ops_clients row as Operacional → Clientes,
// under the same permission.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatDistance } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { useHasPermission } from "@/hooks/use-permissions";
import { demoNetworks, type ClientCardData } from "@/lib/reportei/client-card";
import { INTEGRATION_CATALOG } from "@/lib/reportei/integrations-catalog";
import { cn } from "@/lib/utils";
import { ClientAvatar } from "../_components/client-avatar";
import { NetworkIcon } from "../_components/network-icon";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: ClientCardData[] };
type Filter = "active" | "inactive" | "all";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Local-only preview: with this variable on (.env.local), every card shows a mix of
// networks as if they were linked, so the grid can be judged before more connectors
// exist. Production never sets it, so it never shows made-up data there.
const DEMO_ICONS = process.env.NEXT_PUBLIC_REPORTEI_DEMO_ICONS === "1";
const CATALOG_KEYS = INTEGRATION_CATALOG.map((c) => c.key);
const NETWORK_NAME = new Map(INTEGRATION_CATALOG.map((c) => [c.key, c.name]));

function Card({ client, onOpen }: { client: ClientCardData; onOpen: () => void }) {
  const t = useTranslations("Operational.reportei.clientsPage");
  const locale = useLocale();
  const networks = DEMO_ICONS ? demoNetworks(client.name, CATALOG_KEYS) : client.networks;
  const health = DEMO_ICONS ? "ok" : client.health;
  const when = client.lastReportAt
    ? formatDistance(new Date(client.lastReportAt), new Date(), { addSuffix: true, locale: locale.startsWith("pt") ? ptBR : undefined })
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        client.status === "inactive" && "opacity-60",
      )}
    >
      <ClientAvatar name={client.name} logoUrl={client.logoUrl} size={64} health={health} healthTitle={t(`cardHealth_${health}`)} />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex items-center gap-1.5">
          <ClientCode code={client.code} />
          <span className="truncate text-base font-semibold text-foreground">{client.name}</span>
        </span>

        <span className="flex min-h-5 flex-wrap items-center gap-1.5">
          {networks.length > 0 ? (
            networks.map((n) => (
              <span key={n} title={NETWORK_NAME.get(n) ?? n} className="inline-flex">
                <NetworkIcon network={n} size={18} />
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">{t("cardNoIntegrations")}</span>
          )}
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
              client.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
            )}
          >
            {client.status === "active" ? t("statusActive") : t("statusInactive")}
          </span>
        </span>

        <span className="block text-xs text-muted-foreground">
          {client.reportCount > 0 ? t("cardReports", { count: client.reportCount }) : t("cardNoReports")}
        </span>
        {when && (
          <span className="block text-xs text-muted-foreground">
            <span className="font-semibold text-primary">{t("cardLastReport")}</span> {t("cardGenerated", { when })}
          </span>
        )}
      </span>
    </button>
  );
}

export default function ReporteiClientsPage() {
  const t = useTranslations("Operational.reportei.clientsPage");
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/clients?status=${filter}`);
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", rows: ((await res.json()) as { clients: ClientCardData[] }).clients });
  }, [filter]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    return q ? state.rows.filter((r) => norm(`${r.name} ${r.code ?? ""}`).includes(q)) : state.rows;
  }, [state, query]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="h-9 border-border bg-muted pl-8 text-sm text-foreground"
            />
          </div>
          <Select
            value={filter}
            onValueChange={(v) => {
              if (!v) return;
              setFilter(v as Filter);
              setState({ kind: "loading" });
            }}
          >
            <SelectTrigger aria-label={t("filterLabel")} className="h-9 w-44">
              <SelectValue>{t(`filter_${filter}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("filter_active")}</SelectItem>
              <SelectItem value="inactive">{t("filter_inactive")}</SelectItem>
              <SelectItem value="all">{t("filter_all")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button onClick={() => router.push("/operational/reportei/clientes/novo")}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        )}
      </div>

      {DEMO_ICONS && <p className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{t("demoNote")}</p>}

      {state.kind === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}
      {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state.kind === "ready" &&
        (rows.length === 0 ? (
          <EmptyState title={query.trim() ? t("noResults") : t("empty")} hint={query.trim() ? undefined : t("emptyHint")} className="min-h-40" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <Card key={r.id} client={r} onOpen={() => router.push(`/operational/reportei/clientes/${r.id}`)} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("count", { count: rows.length })}</p>
          </>
        ))}
    </>
  );
}
