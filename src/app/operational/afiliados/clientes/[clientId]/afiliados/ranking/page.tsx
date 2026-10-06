"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { AffiliateProfileDialog } from "../../../../_components/affiliate-profile-dialog";
import { AffiliatesTabs } from "../../../../_components/affiliates-tabs";
import { money } from "../../../../_components/metric";
import { useWorkspace } from "../../../../_components/workspace";

interface Row {
  membership_id: string;
  name: string;
  code: string;
  campaign_id: string;
  campaign_name: string;
  sales_cents: number;
  orders: number;
  cancelled: number;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Row[] };

const ALL = "all";
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

export default function AffiliateRankingPage() {
  const t = useTranslations("Operational.affiliates");
  const { apiBase } = useWorkspace();
  const [month, setMonth] = useState(currentMonth);
  const [campaign, setCampaign] = useState(ALL);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${apiBase}/campaigns`);
      if (cancelled || !res.ok) return;
      setCampaigns(((await res.json()) as { campaigns: { id: string; name: string }[] }).campaigns);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let cancelled = false;
    (async () => {
      const qs = new URLSearchParams({ month });
      if (campaign !== ALL) qs.set("campaign", campaign);
      const res = await fetch(`${apiBase}/affiliates/ranking?${qs}`);
      if (cancelled) return;
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", rows: ((await res.json()) as { ranking: Row[] }).ranking });
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, month, campaign]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("ranking.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("ranking.description")}</p>
      </div>
      <AffiliatesTabs />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rk-month">{t("ranking.month")}</Label>
          <Input
            id="rk-month"
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setState({ kind: "loading" });
            }}
            className="h-9 w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rk-campaign">{t("ranking.campaign")}</Label>
          <Select
            value={campaign}
            onValueChange={(v) => {
              if (!v) return;
              setCampaign(v);
              setState({ kind: "loading" });
            }}
          >
            <SelectTrigger id="rk-campaign" className="h-9 w-64">
              <SelectValue>{campaign === ALL ? t("ranking.allCampaigns") : (campaigns.find((c) => c.id === campaign)?.name ?? "—")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("ranking.allCampaigns")}</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.kind === "loading" && <Skeleton className="h-48" />}
      {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state.kind === "ready" &&
        (state.rows.length === 0 ? (
          <EmptyState title={t("ranking.empty")} hint={t("ranking.emptyHint")} className="min-h-40" />
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">{t("ranking.colPosition")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("ranking.colAffiliate")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("ranking.colCampaign")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("ranking.colSales")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("ranking.colOrders")}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t("ranking.colCancelled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r, i) => (
                    <tr key={r.membership_id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 font-semibold text-foreground">
                        {i === 0 && r.sales_cents > 0 ? <Trophy className="h-4 w-4 text-amber-500" aria-label="1º" /> : `${i + 1}º`}
                      </td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setProfileId(r.membership_id)} className="text-left">
                          <strong className="block font-medium text-foreground hover:text-primary hover:underline">{r.name}</strong>
                          <small className="text-xs text-muted-foreground">{r.code}</small>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{r.campaign_name}</td>
                      <td className="px-3 py-3 text-right font-medium text-foreground">{money(r.sales_cents)}</td>
                      <td className="px-3 py-3 text-right text-foreground">{r.orders}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{r.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{t("ranking.note")}</p>
          </section>
        ))}

      <AffiliateProfileDialog membershipId={profileId} onClose={() => setProfileId(null)} />
    </div>
  );
}
