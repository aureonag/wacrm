"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Gift } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";
import type { Reward } from "@/lib/affiliates/campaigns";

interface Membership {
  id: string;
  code: string;
  status: "pending" | "approved" | "rejected" | "inactive";
  accepted_revision: number | null;
  store: string;
  campaign: {
    id: string;
    name: string;
    description: string;
    discount_type: "PERCENTAGE" | "CURRENCY";
    discount: number;
    frequency: "RECURRENT" | "PERIODIC";
    start_date: string;
    end_date: string | null;
    rewards: Reward[];
    status: string;
    revision: number;
  };
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; memberships: Membership[] };

const STATUS_STYLE: Record<Membership["status"], string> = {
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-destructive/15 text-destructive",
  inactive: "bg-muted text-muted-foreground",
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (iso: string) => iso.split("-").reverse().join("/");

export default function PortalCampaignsPage() {
  const t = useTranslations("Portal.campaigns");
  const ta = useTranslations("Operational.affiliates");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/portal/affiliate/me");
      if (cancelled) return;
      if (!res.ok) return setState({ kind: "error" });
      const data = (await res.json()) as { memberships: Membership[] };
      setState({ kind: "ready", memberships: data.memberships });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <Skeleton className="h-32" />;
  if (state.kind === "error") return <EmptyState title={ta("error")} className="min-h-40" />;

  return (
    <>
      <div>
        <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {state.memberships.length === 0 ? (
        <EmptyState title={t("empty")} hint={t("emptyHint")} className="min-h-40" />
      ) : (
        <ul className="space-y-3">
          {state.memberships.map((m) => {
            const c = m.campaign;
            const reward = c.rewards[0];
            return (
              <li key={m.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{c.name}</h2>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[m.status])}>
                        {ta(`members.status_${m.status}`)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.store}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">{t("code")}</p>
                    <code className="rounded bg-muted px-2 py-0.5 text-sm font-semibold text-foreground">{m.code}</code>
                  </div>
                </div>

                <p className="line-clamp-3 text-xs text-muted-foreground">{c.description}</p>

                <div className="flex flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="rounded-full bg-muted px-2.5 py-1">
                    {c.discount_type === "CURRENCY"
                      ? ta("campaigns.discountOffCurrency", { value: brl.format(c.discount) })
                      : ta("campaigns.discountOffPercent", { value: c.discount })}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                    <Gift className="h-3 w-3" />
                    {!reward
                      ? ta("campaigns.noReward")
                      : reward.type === "OTHER"
                        ? ta("campaigns.rewardOther")
                        : ta(reward.type === "PIX" ? "campaigns.rewardPix" : "campaigns.rewardGiftback", { value: reward.value ?? 0 })}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1">
                    {c.frequency === "PERIODIC"
                      ? ta("campaigns.periodic", { start: formatDate(c.start_date), end: c.end_date ? formatDate(c.end_date) : "" })
                      : ta("campaigns.recurrent", { start: formatDate(c.start_date) })}
                  </span>
                </div>

                {m.status === "pending" && <p className="text-xs text-amber-500">{t("pendingHint")}</p>}
                {m.status === "rejected" && <p className="text-xs text-destructive">{t("rejectedHint")}</p>}
                {m.status === "inactive" && <p className="text-xs text-muted-foreground">{t("inactiveHint")}</p>}
                {m.accepted_revision !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("acceptedVersion", { n: m.accepted_revision })}
                    {c.revision > m.accepted_revision ? ` · ${t("updatedRules", { n: c.revision })}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
