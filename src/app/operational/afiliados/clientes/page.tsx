"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, ChevronRight, Loader2, Pause, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import { useAffiliateClients, type AffiliateClient } from "../_components/use-affiliate-clients";

interface FormState {
  name: string;
  legal_name: string;
  cnpj: string;
  platform: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  notes: string;
}

// Sentinel for "no platform": Select items cannot use an empty-string value.
const NO_PLATFORM = "none";

const EMPTY_FORM: FormState = {
  name: "",
  legal_name: "",
  cnpj: "",
  platform: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  notes: "",
};

function toForm(c: AffiliateClient): FormState {
  return {
    name: c.name,
    legal_name: c.legal_name ?? "",
    cnpj: c.cnpj ?? "",
    platform: c.platform ?? "",
    contact_name: c.contact_name ?? "",
    contact_email: c.contact_email ?? "",
    contact_phone: c.contact_phone ?? "",
    notes: c.notes ?? "",
  };
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function formatCnpj(v: string | null): string {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (v ?? "");
}

export default function AffiliateClientsPage() {
  const t = useTranslations("Operational.affiliates");
  const { state, reload } = useAffiliateClients();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AffiliateClient | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<AffiliateClient | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const clients = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    return q
      ? state.clients.filter((c) => norm(`${c.name} ${c.legal_name ?? ""} ${c.cnpj ?? ""} ${c.contact_email ?? ""}`).includes(q))
      : state.clients;
  }, [state, query]);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditing("new");
  }
  function openEdit(c: AffiliateClient) {
    setForm(toForm(c));
    setEditing(c);
  }
  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function call(url: string, method: "POST" | "PATCH", body: unknown): Promise<boolean> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return true;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    toast.error(res.status === 400 || res.status === 409 ? (data?.error ?? t("saveError")) : t("saveError"));
    return false;
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const isNew = editing === "new";
    const ok = await call(
      isNew ? "/api/operational/affiliates/clients" : `/api/operational/affiliates/clients/${editing.id}`,
      isNew ? "POST" : "PATCH",
      form,
    );
    setSaving(false);
    if (!ok) return;
    toast.success(isNew ? t("clients.created") : t("clients.updated"));
    setEditing(null);
    await reload();
  }

  async function setStatus(c: AffiliateClient, status: "active" | "suspended" | "removed") {
    setBusyId(c.id);
    const ok = await call(`/api/operational/affiliates/clients/${c.id}`, "PATCH", { status });
    setBusyId(null);
    if (!ok) return;
    toast.success(t(`clients.status_${status}`));
    setRemoving(null);
    await reload();
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (state.kind === "not_ready") {
    return <EmptyState title={t("notReadyTitle")} hint={t("notReadyHint")} className="min-h-40" />;
  }
  if (state.kind === "error") {
    return <EmptyState title={t("error")} className="min-h-40" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("headings.clients.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("headings.clients.description")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("clients.search")}
            className="h-9 border-border bg-muted pl-8 text-sm text-foreground"
          />
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          {t("clients.add")}
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState title={query.trim() ? t("clients.noResults") : t("clients.empty")} className="min-h-40" />
      ) : (
        <ul className="space-y-3">
          {clients.map((c) => {
            const suspended = c.status === "suspended";
            const busy = busyId === c.id;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
                <Building2 className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/operational/afiliados/clientes/${c.id}/dashboard`}
                      className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        suspended ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500",
                      )}
                    >
                      {suspended ? t("clients.suspended") : t("clients.active")}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[c.cnpj ? formatCnpj(c.cnpj) : null, c.platform ? t(`clients.platform_${c.platform}`) : null, c.contact_email]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 text-[11px] font-medium text-muted-foreground">
                  <Link
                    href={`/operational/afiliados/clientes/${c.id}/equipe`}
                    className="rounded-full bg-muted px-2.5 py-1 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {t("clients.nUsers", { count: c.users })}
                  </Link>
                  <span className="rounded-full bg-muted px-2.5 py-1">{t("clients.nCampaigns", { count: c.campaigns })}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1">{t("clients.nAffiliates", { count: c.affiliates })}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/operational/afiliados/clientes/${c.id}/dashboard`}
                    className="mr-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                  >
                    {t("clients.openAccount")}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                  <Button variant="ghost" size="icon" aria-label={t("clients.edit")} onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={suspended ? t("clients.reactivate") : t("clients.suspend")}
                    onClick={() => setStatus(c, suspended ? "active" : "suspended")}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : suspended ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("clients.remove")} onClick={() => setRemoving(c)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("clients.addTitle") : t("clients.editTitle")}</DialogTitle>
            <DialogDescription>{t("clients.formHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="aff-name">{t("clients.fieldName")}</Label>
              <Input id="aff-name" value={form.name} onChange={set("name")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-legal">{t("clients.fieldLegalName")}</Label>
              <Input id="aff-legal" value={form.legal_name} onChange={set("legal_name")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-cnpj">{t("clients.fieldCnpj")}</Label>
              <Input id="aff-cnpj" value={form.cnpj} onChange={set("cnpj")} maxLength={30} placeholder="00.000.000/0000-00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-platform">{t("clients.fieldPlatform")}</Label>
              <Select
                value={form.platform || NO_PLATFORM}
                onValueChange={(v) => setForm((f) => ({ ...f, platform: !v || v === NO_PLATFORM ? "" : v }))}
              >
                <SelectTrigger id="aff-platform" className="w-full">
                  <SelectValue>{form.platform ? t(`clients.platform_${form.platform}`) : "—"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PLATFORM}>—</SelectItem>
                  <SelectItem value="nuvemshop">{t("clients.platform_nuvemshop")}</SelectItem>
                  <SelectItem value="tray">{t("clients.platform_tray")}</SelectItem>
                  <SelectItem value="outra">{t("clients.platform_outra")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-contact">{t("clients.fieldContactName")}</Label>
              <Input id="aff-contact" value={form.contact_name} onChange={set("contact_name")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-email">{t("clients.fieldContactEmail")}</Label>
              <Input id="aff-email" type="email" value={form.contact_email} onChange={set("contact_email")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aff-phone">{t("clients.fieldContactPhone")}</Label>
              <Input id="aff-phone" value={form.contact_phone} onChange={set("contact_phone")} maxLength={40} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="aff-notes">{t("clients.fieldNotes")}</Label>
              <Textarea id="aff-notes" value={form.notes} onChange={set("notes")} rows={3} maxLength={5000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("clients.removeTitle", { name: removing?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("clients.removeHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={busyId !== null} onClick={() => removing && setStatus(removing, "removed")}>
              {t("clients.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
