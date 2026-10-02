"use client";

import { useTranslations } from "next-intl";
import { Building2, Megaphone, Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useAffiliateClients } from "./_components/use-affiliate-clients";

export default function AffiliatesOverviewPage() {
  const t = useTranslations("Operational.affiliates");
  const { state } = useAffiliateClients();

  if (state.kind === "loading") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
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

  const active = state.clients.filter((c) => c.status === "active");
  const suspended = state.clients.length - active.length;
  const sum = (key: "campaigns" | "affiliates") => active.reduce((n, c) => n + c[key], 0);

  const cards = [
    { icon: Building2, label: t("overview.activeClients"), value: active.length, hint: t("overview.suspended", { count: suspended }) },
    { icon: Megaphone, label: t("overview.campaigns"), value: sum("campaigns") },
    { icon: Users, label: t("overview.affiliates"), value: sum("affiliates") },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map(({ icon: Icon, label, value, hint }) => (
        <div key={label} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Icon className="h-4 w-4 text-primary" />
            {label}
          </div>
          <p className="mt-3 text-3xl font-bold text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
      ))}
    </div>
  );
}
