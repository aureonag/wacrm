"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Plus, Power, Search, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Campaign } from "@/lib/affiliates/campaigns";

type MembershipStatus = "pending" | "approved" | "rejected" | "inactive";

interface Membership {
  id: string;
  code: string;
  status: MembershipStatus;
  campaign_id: string;
  campaign_name: string;
  affiliate: { id: string; name: string; email: string; phone: string | null; instagram: string | null; has_pix: boolean } | null;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; memberships: Membership[]; campaigns: Campaign[] };

interface FormState {
  name: string;
  email: string;
  phone: string;
  instagram: string;
  campaign_id: string;
  code: string;
  pix_key_type: string;
  pix_key: string;
}
const EMPTY_FORM: FormState = { name: "", email: "", phone: "", instagram: "", campaign_id: "", code: "", pix_key_type: "", pix_key: "" };
const PIX_TYPES = ["cpf", "cnpj", "email", "phone", "random"] as const;

const STATUS_STYLE: Record<MembershipStatus, string> = {
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-destructive/15 text-destructive",
  inactive: "bg-muted text-muted-foreground",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function AffiliateMembersPage() {
  const t = useTranslations("Operational.affiliates");
  const { clientId } = useParams<{ clientId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, c] = await Promise.all([
      fetch(`/api/operational/affiliates/clients/${clientId}/affiliates`),
      fetch(`/api/operational/affiliates/clients/${clientId}/campaigns`),
    ]);
    if (!m.ok || !c.ok) return setState({ kind: "error" });
    const members = (await m.json()) as { memberships: Membership[] };
    const camps = (await c.json()) as { campaigns: Campaign[] };
    setState({ kind: "ready", memberships: members.memberships, campaigns: camps.campaigns });
  }, [clientId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const activeCampaigns = useMemo(
    () => (state.kind === "ready" ? state.campaigns.filter((c) => c.status === "active") : []),
    [state],
  );

  const rows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    if (!q) return state.memberships;
    return state.memberships.filter((m) =>
      norm(`${m.affiliate?.name ?? ""} ${m.affiliate?.email ?? ""} ${m.code} ${m.campaign_name}`).includes(q),
    );
  }, [state, query]);

  function openNew() {
    setForm({ ...EMPTY_FORM, campaign_id: activeCampaigns[0]?.id ?? "" });
    setOpen(true);
  }
  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function create() {
    setSaving(true);
    const res = await fetch(`/api/operational/affiliates/clients/${clientId}/affiliates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(res.status === 400 || res.status === 409 ? (data?.error ?? t("saveError")) : t("saveError"));
      return;
    }
    toast.success(t("members.created"));
    setOpen(false);
    await load();
  }

  async function setStatus(m: Membership, status: "approved" | "rejected" | "inactive") {
    setBusyId(m.id);
    const res = await fetch(`/api/operational/affiliates/clients/${clientId}/affiliates/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    if (!res.ok) return toast.error(t("saveError"));
    toast.success(t(`members.done_${status}`));
    await load();
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const valid = form.name.trim() && form.email.trim() && form.campaign_id && form.code.trim().length >= 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("members.search")}
            className="h-9 border-border bg-muted pl-8 text-sm text-foreground"
          />
        </div>
        <Button onClick={openNew} disabled={activeCampaigns.length === 0}>
          <Plus className="h-4 w-4" />
          {t("members.add")}
        </Button>
      </div>
      {activeCampaigns.length === 0 && <p className="text-xs text-muted-foreground">{t("members.needCampaign")}</p>}

      {rows.length === 0 ? (
        <EmptyState title={query.trim() ? t("members.noResults") : t("members.empty")} className="min-h-40" />
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => {
            const busy = busyId === m.id;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{m.affiliate?.name ?? "—"}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[m.status])}>
                      {t(`members.status_${m.status}`)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[m.affiliate?.email, m.affiliate?.instagram, m.campaign_name].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <code className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{m.code}</code>
                  <span className="text-[11px] text-muted-foreground">{t("members.notSynced")}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {m.status === "pending" && (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => setStatus(m, "approved")}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {t("members.approve")}
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus(m, "rejected")}>
                        <X className="h-3.5 w-3.5" />
                        {t("members.reject")}
                      </Button>
                    </>
                  )}
                  {m.status === "approved" && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus(m, "inactive")}>
                      <Power className="h-3.5 w-3.5" />
                      {t("members.deactivate")}
                    </Button>
                  )}
                  {(m.status === "inactive" || m.status === "rejected") && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus(m, "approved")}>
                      <Check className="h-3.5 w-3.5" />
                      {t("members.reactivate")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && !saving && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("members.addTitle")}</DialogTitle>
            <DialogDescription>{t("members.formHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-name">{t("members.fieldName")}</Label>
              <Input id="m-name" value={form.name} onChange={set("name")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-email">{t("members.fieldEmail")}</Label>
              <Input id="m-email" type="email" value={form.email} onChange={set("email")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-phone">{t("members.fieldPhone")}</Label>
              <Input id="m-phone" value={form.phone} onChange={set("phone")} maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-ig">{t("members.fieldInstagram")}</Label>
              <Input id="m-ig" value={form.instagram} onChange={set("instagram")} maxLength={100} placeholder="@perfil" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-campaign">{t("members.fieldCampaign")}</Label>
              <Select value={form.campaign_id || null} onValueChange={(v) => v && setForm((f) => ({ ...f, campaign_id: v }))}>
                <SelectTrigger id="m-campaign" className="w-full">
                  <SelectValue>{activeCampaigns.find((c) => c.id === form.campaign_id)?.name ?? "—"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeCampaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-code">{t("members.fieldCode")}</Label>
              <Input
                id="m-code"
                value={form.code}
                maxLength={30}
                placeholder="MARIA10"
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-pixtype">{t("members.fieldPixType")}</Label>
              <Select value={form.pix_key_type || null} onValueChange={(v) => v && setForm((f) => ({ ...f, pix_key_type: v }))}>
                <SelectTrigger id="m-pixtype" className="w-full">
                  <SelectValue>{form.pix_key_type ? t(`members.pix_${form.pix_key_type}`) : "—"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PIX_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`members.pix_${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-pix">{t("members.fieldPixKey")}</Label>
              <Input id="m-pix" value={form.pix_key} onChange={set("pix_key")} maxLength={200} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("members.noLoginHint")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={create} disabled={saving || !valid}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
