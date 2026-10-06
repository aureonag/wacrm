"use client";

// Operacional → Clientes: the operation's client registry, like Runrun's
// Empresa → Clientes. Click a client to see its projects; click a project to
// see its tasks. (The old contract-based list lives in the "Contratos" tab.)

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, Loader2, Pause, Play, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { ClientsTabs } from "@/components/operational/clients-tabs";
import { useHasPermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import type { ClientStatus, TaskCounts } from "@/lib/operational/clients-projects";

interface Row {
  id: string;
  name: string;
  code: string | null;
  status: ClientStatus;
  projects: number;
  tasks: TaskCounts;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Row[] };
type Filter = "active" | "inactive" | "all";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function OperationalClientsPage() {
  const t = useTranslations("Operational.opsClients");
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", code: "" });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function create() {
    setSaving(true);
    const res = await fetch("/api/operational/ops-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, code: form.code }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return toast.error([400, 409].includes(res.status) ? (data?.error ?? t("saveError")) : t("saveError"));
    }
    const { id } = (await res.json()) as { id: string };
    toast.success(t("created"));
    setAdding(false);
    router.push(`/operational/clients/${id}`);
  }

  async function toggle(r: Row) {
    setBusyId(r.id);
    const next: ClientStatus = r.status === "active" ? "inactive" : "active";
    const res = await fetch(`/api/operational/ops-clients/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusyId(null);
    if (!res.ok) return toast.error(t("saveError"));
    toast.success(next === "active" ? t("reactivated") : t("deactivated"));
    await load();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <ClientsTabs />

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
          <Button
            onClick={() => {
              setForm({ name: "", code: "" });
              setAdding(true);
            }}
          >
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
                    <th className="px-3 py-2.5 text-right font-medium">{t("colProjects")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("colOpen")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("colDone")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("colOverdue")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("colProgress")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("colStatus")}</th>
                    {canEdit && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pct = r.tasks.total ? Math.round((r.tasks.done / r.tasks.total) * 100) : 0;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => router.push(`/operational/clients/${r.id}`)}
                        className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40", r.status === "inactive" && "opacity-60")}
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 font-medium text-foreground">
                            <Building2 className="h-4 w-4 shrink-0 text-primary" />
                            <ClientCode code={r.code} />
                            {r.name}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-foreground">{r.projects}</td>
                        <td className="px-3 py-3 text-right text-foreground">{r.tasks.open}</td>
                        <td className="px-3 py-3 text-right text-foreground">{r.tasks.done}</td>
                        <td className={cn("px-3 py-3 text-right", r.tasks.overdue ? "font-medium text-red-500" : "text-muted-foreground")}>{r.tasks.overdue}</td>
                        <td className="px-3 py-3">
                          {r.tasks.total ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">{pct}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
                        {canEdit && (
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busyId === r.id}
                              aria-label={r.status === "active" ? t("deactivate") : t("reactivate")}
                              title={r.status === "active" ? t("deactivate") : t("reactivate")}
                              onClick={() => toggle(r)}
                            >
                              {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : r.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{t("count", { count: rows.length })}</p>
          </section>
        ))}

      <Dialog open={adding} onOpenChange={(o) => !o && !saving && setAdding(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addTitle")}</DialogTitle>
            <DialogDescription>{t("addHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="oc-name">{t("fieldName")}</Label>
              <Input id="oc-name" value={form.name} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oc-code">{t("fieldCode")}</Label>
              <Input id="oc-code" value={form.code} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={create} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
