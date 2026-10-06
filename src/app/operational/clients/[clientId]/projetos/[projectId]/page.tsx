"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronRight, Flag, Loader2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useHasPermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import type { ProjectStatus, TaskCounts } from "@/lib/operational/clients-projects";

interface TaskRow {
  id: string;
  number: number | null;
  title: string;
  status: "open" | "done";
  priority: "low" | "medium" | "high";
  is_urgent: boolean;
  due_date: string | null;
  board_id: string;
  board: string;
  stage: string;
  assignee: string;
  overdue: boolean;
}
interface Data {
  project: { id: string; name: string; description: string | null; status: ProjectStatus; start_date: string | null; due_date: string | null };
  client: { id: string; name: string; status: string } | null;
  counts: TaskCounts;
  tasks: TaskRow[];
}
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; data: Data };
type View = "all" | "open" | "done" | "overdue";

const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function OperationalProjectPage() {
  const t = useTranslations("Operational.opsClients");
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", start_date: "", due_date: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/ops-projects/${projectId}`);
    if (res.status === 404) return setState({ kind: "missing" });
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", data: (await res.json()) as Data });
  }, [projectId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const tasks = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    return state.data.tasks.filter((x) => {
      if (view === "open" && x.status !== "open") return false;
      if (view === "done" && x.status !== "done") return false;
      if (view === "overdue" && !x.overdue) return false;
      return !q || norm(`${x.title} ${x.assignee} ${x.stage}`).includes(q);
    });
  }, [state, view, query]);

  async function patch(body: unknown, okMessage: string): Promise<boolean> {
    const res = await fetch(`/api/operational/ops-projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(res.status === 400 ? (data?.error ?? t("saveError")) : t("saveError"));
      return false;
    }
    toast.success(okMessage);
    await load();
    return true;
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (state.kind === "missing") return <EmptyState title={t("projectMissing")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const { project, client, counts } = state.data;
  const archived = project.status === "archived";
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const stats = [
    { label: t("statTotal"), value: counts.total },
    { label: t("statOpen"), value: counts.open },
    { label: t("statDone"), value: counts.done },
    { label: t("statOverdue"), value: counts.overdue, danger: counts.overdue > 0 },
  ];
  const views: View[] = ["all", "open", "done", "overdue"];

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="breadcrumb">
        <Link href="/operational/clients" className="hover:text-foreground">
          {t("title")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/operational/clients/${clientId}`} className="hover:text-foreground">
          {client?.name ?? "—"}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">{project.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            {archived && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("archived")}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {client?.name}
            {project.start_date || project.due_date ? ` · ${brDate(project.start_date)} → ${brDate(project.due_date)}` : ""}
          </p>
          {project.description && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-muted-foreground">{project.description}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setForm({
                  name: project.name,
                  description: project.description ?? "",
                  start_date: project.start_date ?? "",
                  due_date: project.due_date ?? "",
                });
                setEditing(true);
              }}
            >
              <Pencil className="h-4 w-4" />
              {t("edit")}
            </Button>
            <Button variant="outline" onClick={() => patch({ status: archived ? "active" : "archived" }, archived ? t("projectRestored") : t("projectArchived"))}>
              {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {archived ? t("restore") : t("archive")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className={cn("mt-2 text-2xl font-bold", s.danger ? "text-red-500" : "text-foreground")}>{s.value}</p>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("statProgress")}</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{pct}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {views.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === v ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`view_${v}`)}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchTasks")} className="h-9 border-border bg-muted pl-8 text-sm text-foreground" />
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title={state.data.tasks.length === 0 ? t("noTasks") : t("noResults")} hint={state.data.tasks.length === 0 ? t("noTasksHint") : undefined} className="min-h-40" />
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t("colId")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colTitle")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colStage")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colBoard")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colAssignee")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colDue")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((x) => (
                  <tr key={x.id} className={cn("border-b border-border last:border-0", x.overdue && "bg-red-500/5")}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{x.number ? `T-${String(x.number).padStart(4, "0")}` : "—"}</td>
                    <td className="px-3 py-3">
                      <Link href={`/operational/boards/${x.board_id}?task=${x.id}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary hover:underline">
                        {x.is_urgent && <Flag className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label={t("urgent")} />}
                        {x.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-foreground">{x.stage || "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{x.board || "—"}</td>
                    <td className="px-3 py-3 text-foreground">{x.assignee || "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-3", x.overdue ? "font-medium text-red-500" : "text-foreground")}>{brDate(x.due_date)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          x.status === "done" ? "bg-emerald-500/15 text-emerald-500" : x.overdue ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {x.status === "done" ? t("taskDone") : x.overdue ? t("taskOverdue") : t("taskOpen")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Dialog open={editing} onOpenChange={(o) => !o && !saving && setEditing(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editProjectTitle")}</DialogTitle>
            <DialogDescription>{t("addProjectHint", { client: client?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">{t("fieldProjectName")}</Label>
              <Input id="ep-name" value={form.name} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-desc">{t("fieldDescription")}</Label>
              <Textarea id="ep-desc" rows={3} value={form.description} maxLength={5000} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-start">{t("fieldStart")}</Label>
                <Input id="ep-start" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-due">{t("fieldDue")}</Label>
                <Input id="ep-due" type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button
              disabled={saving || !form.name.trim()}
              onClick={async () => {
                setSaving(true);
                const ok = await patch(form, t("projectUpdated"));
                setSaving(false);
                if (ok) setEditing(false);
              }}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
