"use client";

// Operacional → Reportei → Clientes: the same clients as Operacional → Clientes
// (ops_clients), seen from the reporting side. Click a client to open its
// Reportei page (integrations, reports, automations). Registering a client
// stays in Operacional → Clientes so there is a single place and permission.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { useHasPermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import type { ClientStatus } from "@/lib/operational/clients-projects";

interface Row {
  id: string;
  name: string;
  code: string | null;
  status: ClientStatus;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Row[] };
type Filter = "active" | "inactive" | "all";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function ReporteiClientsPage() {
  const t = useTranslations("Operational.reportei.clientsPage");
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/ops-clients?status=${filter}`);
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", rows: ((await res.json()) as { clients: Row[] }).clients });
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
          <Button onClick={() => router.push("/operational/clients")}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state.kind === "ready" &&
        (rows.length === 0 ? (
          <EmptyState title={query.trim() ? t("noResults") : t("empty")} hint={query.trim() ? undefined : t("emptyHint")} className="min-h-40" />
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">{t("colClient")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("colStatus")}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/operational/reportei/clientes/${r.id}`)}
                      className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40", r.status === "inactive" && "opacity-60")}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <Building2 className="h-4 w-4 shrink-0 text-primary" />
                          <ClientCode code={r.code} />
                          {r.name}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            r.status === "active" ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.status === "active" ? t("statusActive") : t("statusInactive")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        <ChevronRight className="ml-auto h-4 w-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{t("count", { count: rows.length })}</p>
          </section>
        ))}
    </>
  );
}
