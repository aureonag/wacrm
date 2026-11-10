// Campaign status is current at collection time; delivery and results belong to the requested period.
export interface CampaignPeriodRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number | null;
  conversations: number | null;
  purchases: number | null;
}

export const CAMPAIGN_FILTERS = ["all", "active", "delivered"] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

const STATUSES: Record<string, string> = {
  ACTIVE: "Ativa", PAUSED: "Pausada", ARCHIVED: "Arquivada", DELETED: "Excluída",
  IN_PROCESS: "Em processamento", WITH_ISSUES: "Com problemas",
};
export const campaignStatusLabel = (status: string) => STATUSES[status] ?? "Status não disponível";

export function filterCampaignRows<T extends Record<string, string | number>>(rows: readonly T[], filter: CampaignFilter): T[] {
  return rows.filter((r) => filter === "all" || (filter === "active" ? r._status === "ACTIVE" : r._delivered === 1));
}

/** Only fetch this extra breakdown when a document/template actually uses it. */
export function needsCampaignTable(source: { blocks: readonly { network?: string; keys?: readonly string[]; widgets?: readonly { key?: string }[] }[] }): boolean {
  return source.blocks.some((b) => b.network === "meta_ads" && (b.keys?.includes("campaigns") || b.widgets?.some((w) => w.key === "campaigns")));
}
