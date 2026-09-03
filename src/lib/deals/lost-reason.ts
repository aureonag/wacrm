/**
 * "Motivo de perda" — why a deal was marked Lost. Shared between the
 * deal detail page's lost-reason dialog and the Dashboard's "Motivos
 * de perda" breakdown, so the key list lives in exactly one place.
 * `deals.lost_reason` has no CHECK constraint, so adding a key here
 * never needs a migration.
 *
 * A value outside this list (only possible via "Outro") is shown
 * verbatim instead of translated — see `formatLostReason` on the deal
 * detail page and its mirror in `lost-reason-card.tsx`.
 */
export const LOST_REASON_KEYS = [
  "price",
  "noResponse",
  "competitor",
  "gaveUp",
  "timing",
  "budget",
  "noValue",
  "wrongProfile",
  "closedInternally",
  "noContact",
  "other",
] as const;

export type LostReasonKey = (typeof LOST_REASON_KEYS)[number];

export function isKnownLostReason(value: string): value is LostReasonKey {
  return (LOST_REASON_KEYS as readonly string[]).includes(value);
}
