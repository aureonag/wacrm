"use client";

// Integrations of one client: the linked ad accounts and the grid of networks
// (Reportei's "Integrações" + "Visão geral"). Linking opens the Meta account
// picker; the networks without a connector yet are listed as "Em breve".

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Globe, Loader2, Megaphone, Plug, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHasPermission } from "@/hooks/use-permissions";
import { INTEGRATION_CATALOG } from "@/lib/reportei/integrations-catalog";
import { cn } from "@/lib/utils";
import { MetaAccountsDialog } from "./meta-accounts-dialog";

export interface Integration {
  id: string;
  provider: string;
  external_account_id: string;
  external_account_name: string | null;
  status: "connected" | "error" | "revoked";
  last_error: string | null;
  created_at: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function IntegrationsPanel({
  clientId,
  clientName,
  integrations,
  onChanged,
  openPicker = false,
  onPickerClosed,
}: {
  clientId: string;
  clientName: string;
  integrations: Integration[];
  onChanged: () => void;
  /** Open the account picker on arrival (coming back from "Entrar com Facebook"). */
  openPicker?: boolean;
  onPickerClosed?: () => void;
}) {
  const t = useTranslations("Operational.reportei.integrations");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(openPicker);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const linkedIds = useMemo(() => new Set(integrations.filter((i) => i.status === "connected").map((i) => i.external_account_id)), [integrations]);
  const cards = useMemo(() => {
    const q = norm(query.trim());
    return q ? INTEGRATION_CATALOG.filter((c) => norm(c.name).includes(q)) : INTEGRATION_CATALOG;
  }, [query]);
  const fmt = useMemo(() => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }), []);

  async function remove(i: Integration) {
    setRemovingId(i.id);
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/integrations/${i.id}`, { method: "DELETE" });
    setRemovingId(null);
    if (!res.ok) return toast.error(t("removeError"));
    toast.success(t("removed"));
    onChanged();
  }

  return (
    <div className="space-y-6">
      {integrations.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>{t("accountCol")}</span>
            <span>{t("integratedOn")}</span>
          </div>
          {integrations.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
              <Megaphone className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{i.external_account_name ?? i.external_account_id}</p>
                <p className="truncate text-xs text-muted-foreground">{i.external_account_id}</p>
              </div>
              <span
                title={i.last_error ?? undefined}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  i.status === "connected" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500",
                )}
              >
                {t(`status_${i.status}`)}
              </span>
              <span className="hidden w-28 text-right text-xs text-muted-foreground sm:block">{fmt.format(new Date(i.created_at))}</span>
              {canEdit && (
                <Button variant="ghost" size="icon" disabled={removingId === i.id} aria-label={t("remove")} title={t("remove")} onClick={() => remove(i)}>
                  {removingId === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">{t("overview")}</h3>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="h-9 border-border bg-muted pl-8 text-sm" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => {
            const count = c.available ? integrations.filter((i) => i.provider === c.key).length : 0;
            const Icon = c.available ? Megaphone : Globe;
            return (
              <div key={c.key} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", count > 0 ? "border-primary/50" : "border-border", !c.available && "opacity-60")}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{count > 0 ? t("accountCount", { count }) : t("noAccount")}</p>
                  </div>
                </div>
                {c.available ? (
                  <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => {
                    const here = new URL(window.location.href);
                    here.searchParams.delete("meta");
                    window.location.assign(`/api/operational/reportei/meta/connect?${new URLSearchParams({ returnTo: here.pathname + here.search })}`);
                  }}>
                    <Plug className="h-3.5 w-3.5" />
                    {t("connectMeta")}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    {t("soon")}
                  </Button>
                )}
                {c.available && <button type="button" disabled={!canEdit} onClick={() => setPicking(true)} className="text-xs font-medium text-primary hover:underline disabled:opacity-50">{t("chooseAuthorized")}</button>}
              </div>
            );
          })}
        </div>
      </section>

      <MetaAccountsDialog open={picking} onOpenChange={(open) => { setPicking(open); if (!open) onPickerClosed?.(); }} clientId={clientId} clientName={clientName} linkedIds={linkedIds} onLinked={onChanged} />
    </div>
  );
}
