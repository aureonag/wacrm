/**
 * "Origem do negócio" — which acquisition channel a deal came from.
 * Shared between the deal-create modal, the deal detail page, and the
 * Dashboard's "Origem dos negócios" breakdown, so the key list lives
 * in exactly one place. `deals.origin` (migration 056) has no CHECK
 * constraint, so adding a key here never needs a migration.
 *
 * A value outside this list (only possible via the "Outro" + free-text
 * complement) is shown verbatim instead of translated — see
 * `formatDealOrigin` below, mirroring `formatLostReason` on the deal
 * detail page.
 */
export const DEAL_ORIGIN_KEYS = [
  "prospectingActive",
  "referral",
  "metaAds",
  "googleAds",
  "googleOrganic",
  "instagram",
  "website",
  "whatsapp",
  "event",
  "partner",
  "automation",
  "other",
] as const;

export type DealOriginKey = (typeof DEAL_ORIGIN_KEYS)[number];

export function isKnownDealOrigin(value: string): value is DealOriginKey {
  return (DEAL_ORIGIN_KEYS as readonly string[]).includes(value);
}
