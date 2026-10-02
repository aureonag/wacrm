"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Gift, Loader2, Pencil, Plus, Power, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/lib/affiliates/campaigns";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; campaigns: Campaign[] };

function formatDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function AffiliateCampaignsPage() {
  const t = useTranslations("Operational.affiliates");
  const { clientId } = useParams<{ clientId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const base = `/operational/afiliados/clientes/${clientId}/campanhas`;

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/affiliates/clients/${clientId}/campaigns`);
    if (!res.ok) return setState({ kind: "error" });
    const data = (await res.json()) as { campaigns: Campaign[] };
    setState({ kind: "ready", campaigns: data.campaigns });
  }, [clientId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function copyLink(c: Campaign) {
    const link = `${window.location.origin}/inscricao/${c.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("campaigns.linkCopied"));
    } catch {
      toast.error(link);
    }
  }

  async function toggle(c: Campaign) {
    setBusyId(c.id);
    const res = await fetch(`/api/operational/affiliates/clients/${clientId}/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "active" ? "inactive" : "active" }),
    });
    setBusyId(null);
    if (!res.ok) return toast.error(t("saveError"));
    toast.success(c.status === "active" ? t("campaigns.deactivated") : t("campaigns.activated"));
    await load();
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`${base}/nova`}>
          <Button>
            <Plus className="h-4 w-4" />
            {t("campaigns.add")}
          </Button>
        </Link>
      </div>

      {state.campaigns.length === 0 ? (
        <EmptyState title={t("campaigns.empty")} hint={t("campaigns.emptyHint")} className="min-h-40" />
      ) : (
        <ul className="space-y-3">
          {state.campaigns.map((c) => {
            const active = c.status === "active";
            const reward = c.rewards[0];
            return (
              <li key={c.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{c.name}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t("campaigns.ecommerce")}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {active ? t("campaigns.active") : t("campaigns.inactive")}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{t("campaigns.revision", { n: c.revision })}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={() => copyLink(c)}>
                      <Copy className="h-3.5 w-3.5" />
                      {t("campaigns.copyLink")}
                    </Button>
                    <Link href={`${base}/${c.id}`}>
                      <Button variant="outline" size="sm">
                        <Pencil className="h-3.5 w-3.5" />
                        {t("campaigns.edit")}
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => toggle(c)}>
                      {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                      {active ? t("campaigns.deactivate") : t("campaigns.activate")}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="rounded-full bg-muted px-2.5 py-1">
                    {c.discount_type === "CURRENCY"
                      ? t("campaigns.discountOffCurrency", { value: brl.format(Number(c.discount)) })
                      : t("campaigns.discountOffPercent", { value: Number(c.discount) })}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                    <Gift className="h-3 w-3" />
                    {!reward
                      ? t("campaigns.noReward")
                      : reward.type === "OTHER"
                        ? t("campaigns.rewardOther")
                        : t(reward.type === "PIX" ? "campaigns.rewardPix" : "campaigns.rewardGiftback", { value: reward.value ?? 0 })}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1">
                    {c.frequency === "PERIODIC"
                      ? t("campaigns.periodic", { start: formatDate(c.start_date), end: c.end_date ? formatDate(c.end_date) : "" })
                      : t("campaigns.recurrent", { start: formatDate(c.start_date) })}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                    <Users className="h-3 w-3" />
                    {t("campaigns.participants", { count: c.participants ?? 0 })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
