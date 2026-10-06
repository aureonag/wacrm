"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronRight, FolderKanban, Loader2, Pause, Pencil, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { useHasPermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import type { ClientStatus, ProjectStatus, TaskCounts } from "@/lib/operational/clients-projects";

interface ClientData {
  id: string;
  name: string;
  code: string | null;
  status: ClientStatus;
  notes: string | null;
}
interface ProjectCard {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  tasks: TaskCounts;
}
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; client: ClientData; projects: ProjectCard[] };

export default function OperationalClientPage() {
  const t = useTranslations("Operational.opsClients");
  const router = useRouter();
  const { clientId } = useParams<{ clientId: string }>();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", notes: "" });
  const [project, setProject] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/ops-clients/${clientId}`);
    if (res.status === 404) return setState({ kind: "missing" });
    if (!res.ok) return setState({ kind: "error" });
    const data = (await res.json()) as { client: ClientData; projects: ProjectCard[] };
    setState({ kind: "ready", client: data.client, projects: data.projects });
  }, [clientId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<Response | null> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return res;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    toast.error([400, 409].includes(res.status) ? (data?.error ?? t("saveError")) : t("saveError"));
    return null;
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    );
  }
  if (state.kind === "missing") return <EmptyState title={t("clientMissing")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const { client } = state;
  const inactive = client.status === "inactive";
  const visible = state.projects.filter((p) => showArchived || p.status === "active");
  const archivedCount = state.projects.filter((p) => p.status === "archived").length;

  async function saveClient() {
    setSaving(true);
    const res = await send(`/api/operational/ops-clients/${clientId}`, "PATCH", { name: form.name, code: form.code, notes: form.notes });
    setSaving(false);
    if (!res) return;
    toast.success(t("updated"));
    setEditing(false);
    await load();
  }

  async function toggleStatus() {
    setBusy(true);
    const res = await send(`/api/operational/ops-clients/${clientId}`, "PATCH", { status: inactive ? "active" : "inactive" });
    setBusy(false);
    if (!res) return;
    toast.success(inactive ? t("reactivated") : t("deactivated"));
    await load();
  }

  async function createProject() {
    setSaving(true);
    const res = await send(`/api/operational/ops-clients/${clientId}/projects`, "POST", project);
    setSaving(false);
    if (!res) return;
    const { id } = (await res.json()) as { id: string };
    toast.success(t("projectCreated"));
    setAdding(false);
    router.push(`/operational/clients/${clientId}/projetos/${id}`);
  }

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="breadcrumb">
        <Link href="/operational/clients" className="hover:text-foreground">
          {t("title")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ClientCode code={client.code} />
          {client.name}
        </span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-foreground">
              <ClientCode code={client.code} />
              {client.name}
            </h1>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                inactive ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-500",
              )}
            >
              {inactive ? t("statusInactive") : t("statusActive")}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("projectsCount", { count: state.projects.filter((p) => p.status === "active").length })}
          </p>
          {client.notes && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-muted-foreground">{client.notes}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setForm({ name: client.name, code: client.code ?? "", notes: client.notes ?? "" });
                setEditing(true);
              }}
            >
              <Pencil className="h-4 w-4" />
              {t("edit")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={toggleStatus}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : inactive ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {inactive ? t("reactivate") : t("deactivate")}
            </Button>
            <Button
              disabled={inactive}
              title={inactive ? t("inactiveNoProject") : undefined}
              onClick={() => {
                setProject({ name: "", description: "" });
                setAdding(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("addProject")}
            </Button>
          </div>
        )}
      </div>

      {archivedCount > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t("showArchived", { count: archivedCount })}
        </label>
      )}

      {visible.length === 0 ? (
        <EmptyState title={t("noProjects")} hint={t("noProjectsHint")} className="min-h-40" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => {
            const pct = p.tasks.total ? Math.round((p.tasks.done / p.tasks.total) * 100) : 0;
            return (
              <li key={p.id}>
                <Link
                  href={`/operational/clients/${clientId}/projetos/${p.id}`}
                  className={cn(
                    "block h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40",
                    p.status === "archived" && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                      {p.name}
                    </h2>
                    {p.status === "archived" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("archived")}</span>
                    )}
                  </div>
                  {p.description && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{t("doneOfTotal", { done: p.tasks.done, total: p.tasks.total })}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{t("openCount", { count: p.tasks.open })}</span>
                    {p.tasks.overdue > 0 && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-500">{t("overdueCount", { count: p.tasks.overdue })}</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing} onOpenChange={(o) => !o && !saving && setEditing(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
            <DialogDescription>{t("addHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-name">{t("fieldName")}</Label>
              <Input id="ec-name" value={form.name} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-code">{t("fieldCode")}</Label>
              <Input id="ec-code" value={form.code} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-notes">{t("fieldNotes")}</Label>
              <Textarea id="ec-notes" rows={3} value={form.notes} maxLength={5000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={saveClient} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={(o) => !o && !saving && setAdding(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addProjectTitle")}</DialogTitle>
            <DialogDescription>{t("addProjectHint", { client: client.name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-name">{t("fieldProjectName")}</Label>
              <Input id="np-name" value={project.name} maxLength={200} placeholder={t("projectPlaceholder")} onChange={(e) => setProject((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-desc">{t("fieldDescription")}</Label>
              <Textarea id="np-desc" rows={3} value={project.description} maxLength={5000} onChange={(e) => setProject((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={createProject} disabled={saving || !project.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
