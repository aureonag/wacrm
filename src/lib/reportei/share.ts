// Validity of a public report link. Pure.

export const SHARE_DAYS = [7, 30, 90] as const;
export type ShareDays = (typeof SHARE_DAYS)[number];

const DAY = 24 * 60 * 60 * 1000;

/** `undefined` when the value is not a valid choice; `null` means the link does not expire. */
export function parseShareDays(v: unknown): ShareDays | null | undefined {
  if (v === null) return null;
  return typeof v === "number" && (SHARE_DAYS as readonly number[]).includes(v) ? (v as ShareDays) : undefined;
}

/** When a link made `now` and valid for `days` stops working (ISO), or null for no expiry. */
export function expiryFrom(days: ShareDays | null, now = new Date()): string | null {
  return days === null ? null : new Date(now.getTime() + days * DAY).toISOString();
}

/** True when the link has an expiry that has passed. */
export function isExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= now.getTime();
}

/** The choice that matches an expiry date, for the selector: the nearest option at or above the days left, or "custom" when none fits. */
export function daysLeft(expiresAt: string | null | undefined, now = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY));
}
