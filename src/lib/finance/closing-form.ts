// State + conversions for the "Faturamento" step of the closing dialog.
// Kept pure so the money/percent parsing is unit-tested.

import type { FinanceInput } from "./closing";

export interface FinanceItemState {
  key: string;
  label: string;
  serviceLineId: string;
  amount: string;
  promo: boolean;
  promoMonths: string;
  promoAmount: string;
}

export interface CommissionState {
  key: string;
  profileId: string;
  pct: string;
}

export interface FinanceState {
  code: string;
  name: string;
  firstPaymentDate: string;
  items: FinanceItemState[];
  commissions: CommissionState[];
}

/** "1.234,56" | "1234,56" | "1234.56" | "1234" -> number; empty/garbage -> NaN. */
export function parseMoney(raw: string): number {
  const text = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!text) return NaN;
  // Brazilian thousands separator: "1.234,56" or "1.234"
  const normalized = /,/.test(text) ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function parsePct(raw: string): number {
  if (!raw.trim()) return NaN;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

let seq = 0;
export const newKey = () => `k${++seq}`;

export function initialFinanceState(params: {
  client: { code: string | null; name: string };
  monthlyItems: { id: string; label: string | null; value: number }[];
  defaultProfileId: string | null;
}): FinanceState {
  return {
    code: params.client.code ?? "",
    name: params.client.name,
    firstPaymentDate: "",
    items: params.monthlyItems.map((item) => ({
      key: item.id,
      label: item.label?.trim() || "",
      serviceLineId: "",
      amount: String(item.value ?? "").replace(".", ","),
      promo: false,
      promoMonths: "3",
      promoAmount: "",
    })),
    commissions: params.defaultProfileId
      ? [{ key: newKey(), profileId: params.defaultProfileId, pct: "100" }]
      : [],
  };
}

export function toFinanceInput(state: FinanceState): FinanceInput {
  return {
    firstPaymentDate: state.firstPaymentDate,
    items: state.items.map((item) => ({
      serviceLineId: item.serviceLineId,
      code: state.code.trim() || null,
      name: state.name.trim(),
      amount: parseMoney(item.amount),
      promoMonths: item.promo ? Math.trunc(Number(item.promoMonths)) || 0 : 0,
      promoAmount: item.promo ? parseMoney(item.promoAmount) : 0,
    })),
    commissions: state.commissions.map((c) => ({ profileId: c.profileId, pct: parsePct(c.pct) })),
  };
}
