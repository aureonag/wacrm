// Operacional → Reportei: networks shown in the integrations grid (step 2 of
// "Novo cliente" and the Integrações tab). Only `available` ones can be linked
// today; the rest are listed so the grid looks like Reportei's and can grow.

export type IntegrationProvider = "meta_ads";

export interface CatalogEntry {
  /** Stable key; for `available` entries it is also the `provider` stored in ad_integrations. */
  key: string;
  name: string;
  available: boolean;
}

export const INTEGRATION_CATALOG: readonly CatalogEntry[] = [
  { key: "meta_ads", name: "Meta Ads", available: true },
  { key: "instagram_business", name: "Instagram Business", available: false },
  { key: "facebook", name: "Facebook", available: false },
  { key: "google_analytics_4", name: "Google Analytics 4", available: false },
  { key: "google_ads", name: "Google Ads", available: false },
  { key: "youtube", name: "YouTube", available: false },
  { key: "linkedin", name: "LinkedIn", available: false },
  { key: "tiktok", name: "TikTok", available: false },
];
