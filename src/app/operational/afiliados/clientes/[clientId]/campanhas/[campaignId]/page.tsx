"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import type { Campaign } from "@/lib/affiliates/campaigns";
import { CampaignEditor } from "@/app/operational/afiliados/_components/campaign-editor";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; campaign: Campaign };

export default function EditAffiliateCampaignPage() {
  const t = useTranslations("Operational.affiliates");
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/operational/affiliates/clients/${clientId}/campaigns/${campaignId}`);
      if (cancelled) return;
      if (res.status === 404) return setState({ kind: "missing" });
      if (!res.ok) return setState({ kind: "error" });
      const data = (await res.json()) as { campaign: Campaign };
      setState({ kind: "ready", campaign: data.campaign });
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, campaignId]);

  if (state.kind === "loading") return <Skeleton className="h-64" />;
  if (state.kind === "missing") return <EmptyState title={t("campaigns.notFound")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;
  return <CampaignEditor clientId={clientId} campaign={state.campaign} />;
}
