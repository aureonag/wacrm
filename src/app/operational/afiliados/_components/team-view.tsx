"use client";

// The people of a store (loja) and what each one may do. Used by the Aureon
// team (Operacional → Afiliados → client → Equipe) and by the owner of the
// store in the portal. The server checks every change (team permission, no
// self lock-out, always one active owner).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Mail, Pause, Pencil, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { STORE_MODULES, STORE_ROLES, type StoreModule, type StoreOverrides, type StoreRole } from "@/lib/affiliates/store-access";
import type { StoreUser } from "@/lib/affiliates/store-users";
import { Badge } from "./metric";
import { useWorkspace } from "./workspace";

type Level = "inherit" | "none" | "view" | "edit";
const LEVELS: Level[] = ["inherit", "none", "view", "edit"];

interface Form {
  name: string;
  email: string;
  role: StoreRole;
  password: string;
  levels: Record<StoreModule, Level>;
}

const blankLevels = () => Object.fromEntries(STORE_MODULES.map((m) => [m, "inherit"])) as Record<StoreModule, Level>;
const EMPTY: Form = { name: "", email: "", role: "viewer", password: "", levels: blankLevels() };

function levelsFrom(overrides: StoreOverrides): Record<StoreModule, Level> {
  const out = blankLevels();
  for (const m of STORE_MODULES) {
    const o = overrides[m];
    if (!o) continue;
    out[m] = o.includes("edit") ? "edit" : o.includes("view") ? "view" : "none";
  }
  return out;
}

function overridesFrom(levels: Record<StoreModule, Level>): StoreOverrides {
  const out: StoreOverrides = {};
  for (const m of STORE_MODULES) {
    const l = levels[m];
    if (l === "none") out[m] = [];
    else if (l === "view") out[m] = ["view"];
    else if (l === "edit") out[m] = ["view", "edit"];
  }
  return out;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; users: StoreUser[] };

export function TeamView() {
  const t = useTranslations("Operational.affiliates");
  const { apiBase, can } = useWorkspace();
  const canEdit = can("team", "edit");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [editing, setEditing] = useState<StoreUser | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${apiBase}/users`);
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", users: ((await res.json()) as { users: StoreUser[] }).users });
  }, [apiBase]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function openNew() {
    setForm({ ...EMPTY, levels: blankLevels() });
    setEditing("new");
  }
  function openEdit(u: StoreUser) {
    setForm({ name: u.name, email: u.email, role: u.role, password: "", levels: levelsFrom(u.overrides) });
    setEditing(u);
  }

  async function call(url: string, method: "POST" | "PATCH", body: unknown): Promise<Response | null> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return res;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 503 && data?.error === "portal_not_ready") toast.error(t("team.notReady"));
    else toast.error([400, 409, 429, 502, 503].includes(res.status) ? (data?.error ?? t("saveError")) : t("saveError"));
    return null;
  }

  async function resendInvite(u: StoreUser) {
    setBusyId(u.id);
    const res = await fetch(`${apiBase}/users/${u.id}/invite`, { method: "POST" });
    setBusyId(null);
    if (res.ok) return toast.success(t("team.inviteSent"));
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    toast.error(res.status === 503 && data?.error === "portal_not_ready" ? t("team.notReady") : (data?.error ?? t("saveError")));
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const isNew = editing === "new";
    const res = isNew
      ? await call(`${apiBase}/users`, "POST", {
          name: form.name,
          email: form.email,
          role: form.role,
          password: form.password || undefined,
          permissions: overridesFrom(form.levels),
        })
      : await call(`${apiBase}/users/${editing.id}`, "PATCH", {
          name: form.name,
          role: form.role,
          permissions: overridesFrom(form.levels),
        });
    setSaving(false);
    if (!res) return;
    if (isNew) {
      const created = (await res.json().catch(() => null)) as { invite_sent?: boolean } | null;
      if (!form.password && created?.invite_sent === false) toast.warning(t("team.addedNoInvite"));
      else toast.success(form.password ? t("team.added") : t("team.addedInvite"));
    } else {
      toast.success(t("team.updated"));
    }
    setEditing(null);
    await load();
  }

  async function setStatus(u: StoreUser, status: "active" | "disabled") {
    setBusyId(u.id);
    const res = await call(`${apiBase}/users/${u.id}`, "PATCH", { status });
    setBusyId(null);
    if (!res) return;
    toast.success(status === "disabled" ? t("team.disabled") : t("team.reactivated"));
    await load();
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const isNew = editing === "new";
  const valid = form.name.trim() && (!isNew || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()));

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t("team.add")}
          </Button>
        </div>
      )}

      {state.users.length === 0 ? (
        <EmptyState title={t("team.empty")} hint={t("team.emptyHint")} className="min-h-40" />
      ) : (
        <ul className="space-y-2">
          {state.users.map((u) => {
            const disabled = u.status === "disabled";
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{u.name}</p>
                    <Badge tone={u.role === "owner" ? "info" : "muted"}>{t(`team.role_${u.role}`)}</Badge>
                    {disabled && <Badge tone="warn">{t("team.statusDisabled")}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    {!disabled && (
                      <Button variant="outline" size="sm" disabled={busyId === u.id} onClick={() => resendInvite(u)}>
                        <Mail className="h-3.5 w-3.5" />
                        {t("team.resendInvite")}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t("team.edit")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === u.id}
                      onClick={() => setStatus(u, disabled ? "active" : "disabled")}
                    >
                      {busyId === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : disabled ? (
                        <Play className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                      {disabled ? t("team.reactivate") : t("team.disable")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !saving && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? t("team.addTitle") : t("team.editTitle")}</DialogTitle>
            <DialogDescription>{t("team.formHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tm-name">{t("team.fieldName")}</Label>
              <Input id="tm-name" value={form.name} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-email">{t("team.fieldEmail")}</Label>
              <Input
                id="tm-email"
                type="email"
                value={form.email}
                maxLength={200}
                disabled={!isNew}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-role">{t("team.fieldRole")}</Label>
              <Select value={form.role} onValueChange={(v) => v && setForm((f) => ({ ...f, role: v as StoreRole }))}>
                <SelectTrigger id="tm-role" className="w-full">
                  <SelectValue>{t(`team.role_${form.role}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STORE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`team.role_${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t(`team.roleHint_${form.role}`)}</p>
            </div>
            {isNew && (
              <div className="space-y-1.5">
                <Label htmlFor="tm-pass">{t("team.fieldPassword")}</Label>
                <Input
                  id="tm-pass"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground">{t("team.passwordHint")}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t("team.permissionsTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("team.permissionsHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {STORE_MODULES.map((m) => (
                <div key={m} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                  <span className="text-sm text-foreground">{t(`team.module_${m}`)}</span>
                  <Select
                    value={form.levels[m]}
                    onValueChange={(v) => v && setForm((f) => ({ ...f, levels: { ...f.levels, [m]: v as Level } }))}
                  >
                    <SelectTrigger aria-label={t(`team.module_${m}`)} className="h-8 w-36">
                      <SelectValue>{t(`team.level_${form.levels[m]}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {t(`team.level_${l}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving || !valid}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
