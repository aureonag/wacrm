// ============================================================
// Financeiro side of the deal closing sheet ("ficha de fechamento").
// Pure functions — the route computes the schedule and commission
// amounts here, and the close_deal_with_sheet RPC only persists them.
// ============================================================

export interface ParsedDealTitle {
  code: string | null;
  name: string;
}

/** "00350 - Dr Aline Bueno" -> code 00350; anything after a "|" is a complement, not the name. */
export function parseDealTitle(title: string): ParsedDealTitle {
  const trimmed = title.trim();
  const match = /^(\d{1,8})\s*[-–—]\s*(.+)$/.exec(trimmed);
  const rest = match ? match[2] : trimmed;
  const name = rest.split("|")[0].trim() || rest.trim();
  return { code: match ? match[1] : null, name };
}

export interface ScheduleEntry {
  year: number;
  month: number;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * One row per month from the first payment month through December of that
 * year. Contracts run "until cancelled"; extending past December is the
 * projection's job, not this schedule's.
 */
export function buildMonthlySchedule(p: {
  firstPaymentDate: string;
  amount: number;
  promoMonths: number;
  promoAmount: number;
}): ScheduleEntry[] {
  const date = parseIsoDate(p.firstPaymentDate);
  if (!date) return [];
  const out: ScheduleEntry[] = [];
  for (let i = 0; date.month + i <= 12; i++) {
    out.push({
      year: date.year,
      month: date.month + i,
      amount: round2(i < p.promoMonths ? p.promoAmount : p.amount),
    });
  }
  return out;
}

export interface CommissionShare {
  profileId: string;
  pct: number;
  amount: number;
}

/** Splits `base` by percentage in whole cents; the leftover cent(s) go to the first recipient. */
export function splitCommission(base: number, recipients: { profileId: string; pct: number }[]): CommissionShare[] {
  const totalCents = Math.round(base * 100);
  const shares = recipients.map((r) => ({
    profileId: r.profileId,
    pct: r.pct,
    cents: Math.floor((totalCents * r.pct) / 100 + 1e-9),
  }));
  const leftover = totalCents - shares.reduce((s, r) => s + r.cents, 0);
  if (shares.length > 0) shares[0].cents += leftover;
  return shares.map((s) => ({ profileId: s.profileId, pct: s.pct, amount: s.cents / 100 }));
}

/** "Felipe Cordeiro Queiroz" -> "Comissão Felipe" (same naming as the existing expense categories). */
export function commissionCategoryName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] || fullName.trim();
  return `Comissão ${first}`;
}

export interface FinanceItemInput {
  serviceLineId: string;
  code: string | null;
  name: string;
  amount: number;
  promoMonths: number;
  promoAmount: number;
}

export interface FinanceInput {
  firstPaymentDate: string;
  items: FinanceItemInput[];
  commissions: { profileId: string; pct: number }[];
}

export type FinanceError =
  | "invalid_date"
  | "no_items"
  | "invalid_item"
  | "invalid_promo"
  | "invalid_commission"
  | "commission_sum";

export function validateFinance(input: FinanceInput): FinanceError | null {
  if (!parseIsoDate(input.firstPaymentDate)) return "invalid_date";
  if (input.items.length === 0) return "no_items";

  for (const item of input.items) {
    if (!item.serviceLineId || !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0) {
      return "invalid_item";
    }
    if (!Number.isInteger(item.promoMonths) || item.promoMonths < 0 || item.promoMonths > 11) return "invalid_promo";
    if (item.promoMonths > 0 && (!Number.isFinite(item.promoAmount) || item.promoAmount < 0)) return "invalid_promo";
  }

  if (input.commissions.length > 0) {
    const seen = new Set<string>();
    let sum = 0;
    for (const c of input.commissions) {
      if (!c.profileId || seen.has(c.profileId) || !Number.isFinite(c.pct) || c.pct <= 0 || c.pct > 100) {
        return "invalid_commission";
      }
      seen.add(c.profileId);
      sum += c.pct;
    }
    if (Math.abs(sum - 100) > 0.01) return "commission_sum";
  }
  return null;
}

/** What the client pays in the first month, across every monthly item. */
export function firstMonthTotal(input: FinanceInput): number {
  const cents = input.items.reduce((sum, item) => {
    const first = buildMonthlySchedule({
      firstPaymentDate: input.firstPaymentDate,
      amount: item.amount,
      promoMonths: item.promoMonths,
      promoAmount: item.promoAmount,
    })[0];
    return sum + Math.round((first?.amount ?? 0) * 100);
  }, 0);
  return cents / 100;
}
