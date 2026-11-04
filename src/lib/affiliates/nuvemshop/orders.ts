// Reads a Nuvemshop order into what the affiliate module needs. Pure.
//
// The coupon list of an order is not documented in detail, so it is read
// defensively: an item may be an object with `code`, or just the code.

export type AffOrderStatus = "paid" | "cancelled" | "pending";

export interface ParsedOrder {
  externalId: string;
  number: string | null;
  status: AffOrderStatus;
  /** Net value of the products in cents: after every discount, shipping excluded. */
  totalCents: number;
  couponCodes: string[];
  orderedAt: string | null;
  paidAt: string | null;
}

function money(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * paid → "paid" (even when the order is already closed/shipped).
 * cancelled order, voided/refunded/abandoned payment → "cancelled".
 * Everything else (pending, authorized, partially paid) → "pending".
 * A partial refund keeps the order paid: the commission is the team's call.
 */
export function mapOrderStatus(status: unknown, paymentStatus: unknown): AffOrderStatus {
  if (status === "cancelled") return "cancelled";
  if (paymentStatus === "voided" || paymentStatus === "refunded" || paymentStatus === "abandoned") return "cancelled";
  if (paymentStatus === "paid" || paymentStatus === "partially_refunded") return "paid";
  return "pending";
}

export function couponCodesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const code = typeof item === "string" ? item : item && typeof item === "object" ? (item as { code?: unknown }).code : null;
    if (typeof code === "string" && code.trim()) out.push(code.trim().toUpperCase());
  }
  return out;
}

/** Null when the payload is not an order (no id). */
export function parseOrder(raw: unknown): ParsedOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "number" || typeof o.id === "string" ? String(o.id) : "";
  if (!id) return null;

  const subtotal = money(o.subtotal);
  const discount = money(o.discount) ?? 0;
  const total = money(o.total);
  // Products after discounts; without a subtotal, the total is the best we have.
  const base = subtotal !== null ? subtotal - discount : (total ?? 0);

  return {
    externalId: id,
    number: o.number === undefined || o.number === null ? null : String(o.number),
    status: mapOrderStatus(o.status, o.payment_status),
    totalCents: Math.max(0, Math.round(base * 100)),
    couponCodes: couponCodesOf(o.coupon),
    orderedAt: iso(o.created_at),
    paidAt: iso(o.paid_at),
  };
}
