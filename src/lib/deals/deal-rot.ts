/**
 * "Deal rot" — days since a deal was last touched (`updated_at`, or
 * `created_at` for a deal that's never been updated). Only meaningful
 * for open deals; won/lost deals are done, not stale.
 */
export const DEAL_ROT_THRESHOLD_DAYS = 7;

export function daysSinceUpdate(deal: { updated_at?: string; created_at: string }): number {
  const last = new Date(deal.updated_at ?? deal.created_at).getTime();
  return Math.floor((Date.now() - last) / 86_400_000);
}

export function isStaleDeal(deal: { status?: string; updated_at?: string; created_at: string }): boolean {
  return deal.status === "open" && daysSinceUpdate(deal) >= DEAL_ROT_THRESHOLD_DAYS;
}
