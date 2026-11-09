// From the snapshots of a client's Meta accounts to the readings of the general
// dashboard. Pure. A missing number stays missing (null + why): it is never turned into
// zero, and money is never added across currencies.

import { CONVERSATION_ACTION, cplOf } from "./meta-ads";
import type { ClientStatus, Reading, ReadingFormat, Why } from "./overview";
import type { AccountSnapshot } from "./report";

const r2 = (n: number) => Math.round(n * 100) / 100;

const reading = (key: string, label: string, format: ReadingFormat, upIsGood: boolean, value: number | null, previous: number | null, opts: { neutral?: boolean; why?: Why } = {}): Reading => ({
  key,
  label,
  value: value === null ? null : r2(value),
  previous: previous === null ? null : r2(previous),
  format,
  upIsGood,
  ...(opts.neutral ? { neutral: true } : {}),
  ...(value === null && opts.why ? { why: opts.why } : {}),
});

export interface ClientRead {
  status: ClientStatus;
  currency: string | null;
  readings: Reading[];
}

/** The unavailable reading of every metric, for a client that could not be read. */
function allUnavailable(why: Why): Reading[] {
  const un = (key: string, label: string, format: ReadingFormat, upIsGood: boolean, neutral = false) => reading(key, label, format, upIsGood, null, null, { why, neutral });
  return [
    un("spend", "Investimento", "money", true, true),
    un("revenue", "Faturamento", "money", true),
    un("leads", "Leads", "number", true),
    un("conversations", "Conversas por mensagem iniciadas", "number", true),
    un("direct_leads", "Leads gerados", "number", true),
    un("direct_cpl", "CPL", "money", false),
    un("cost_per_conversation", "Custo por conversa", "money", false),
    un("purchases", "Compras", "number", true),
    un("roas", "ROAS", "ratio", true),
    un("cpl", "CPL", "money", false),
    un("cpa", "CPA", "money", false),
    un("cpc", "CPC", "money", false, true),
    un("ctr", "CTR", "percent", true, true),
  ];
}

/** Sums one optional field over the accounts; null when none of them has it (not measured), never 0 then. */
function sumOptional(list: readonly (number | null | undefined)[]): number | null {
  const present = list.filter((v): v is number => typeof v === "number");
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export function readingsOf(accounts: readonly AccountSnapshot[]): ClientRead {
  if (accounts.length === 0) return { status: "no_integration", currency: null, readings: allUnavailable("no_integration") };
  const ok = accounts.filter((a) => a.insights);
  if (ok.length === 0) return { status: "failed", currency: null, readings: allUnavailable("failed") };
  const status: ClientStatus = ok.length < accounts.length ? "partial" : "ok";
  if (status === "partial") return { status, currency: null, readings: allUnavailable("partial") };

  // Different events are different things: accounts that count a result with another event are not added together.
  const distinct = (pick: (i: NonNullable<AccountSnapshot["insights"]>) => string | null | undefined) => new Set(ok.map((a) => pick(a.insights!)).filter((e): e is string => !!e)).size > 1;
  const mixedLeadEvents = distinct((i) => i.leadEvent);
  const mixedPurchaseEvents = distinct((i) => i.purchaseEvent);
  const currencies = new Set(ok.map((a) => a.currency ?? "?"));
  const mixed = currencies.size > 1 || currencies.has("?");
  const currency = mixed ? null : (ok[0].currency ?? null);
  // The comparison is only fair when every readable account has its previous numbers.
  const hasPrev = ok.every((a) => a.previous);
  const money = (v: number | null): { value: number | null; why?: Why } => (mixed ? { value: null, why: "mixed_currency" } : { value: v });

  const now = ok.map((a) => a.insights!);
  const before = hasPrev ? ok.map((a) => a.previous!) : null;
  const spendNow = now.reduce((a, x) => a + x.spend, 0);
  const spendBefore = before ? before.reduce((a, x) => a + x.spend, 0) : null;
  const clicksNow = now.reduce((a, x) => a + x.clicks, 0);
  const clicksBefore = before ? before.reduce((a, x) => a + x.clicks, 0) : null;
  const imprNow = now.reduce((a, x) => a + x.impressions, 0);
  const imprBefore = before ? before.reduce((a, x) => a + x.impressions, 0) : null;
  const leadsNow = mixedLeadEvents || now.some((x) => x.leads === undefined) ? null : now.reduce((a, x) => a + (x.leads ?? 0), 0);
  const leadsBefore = mixedLeadEvents || !before || before.some((x) => x.leads === undefined) ? null : before.reduce((a, x) => a + (x.leads ?? 0), 0);
  const conversationsNow = now.some((x) => x.conversations === undefined) ? null : now.reduce((a, x) => a + (x.conversations ?? 0), 0);
  const conversationsBefore = !before || before.some((x) => x.conversations === undefined) ? null : before.reduce((a, x) => a + (x.conversations ?? 0), 0);
  const directLeadValue = (i: NonNullable<AccountSnapshot["insights"]>) => i.directLeads ?? (i.leadEvent === CONVERSATION_ACTION ? null : i.leads ?? null);
  const mixedDirectEvents = distinct((i) => i.directLeadEvent === undefined ? i.leadEvent : i.directLeadEvent);
  const sumDirect = (list: typeof now | null) => !list || mixedDirectEvents || list.some((i) => directLeadValue(i) === null) ? null : list.reduce((sum, i) => sum + (directLeadValue(i) ?? 0), 0);
  const directNow = sumDirect(now);
  const directBefore = sumDirect(before);
  const purchasesNow = mixedPurchaseEvents ? null : sumOptional(now.map((x) => x.purchases));
  const purchasesBefore = mixedPurchaseEvents || !before ? null : sumOptional(before.map((x) => x.purchases));
  const valueNow = mixedPurchaseEvents ? null : sumOptional(now.map((x) => x.purchaseValue));
  const valueBefore = mixedPurchaseEvents || !before ? null : sumOptional(before.map((x) => x.purchaseValue));
  const eventWhy = (fallback: Why): Why => (mixedPurchaseEvents ? "mixed_events" : fallback);

  const div = (a: number | null, b: number | null) => (a === null || b === null || b <= 0 ? null : a / b);
  const spendM = money(spendNow);
  const spendBM = money(spendBefore);
  const revM = money(valueNow);
  const revBM = money(valueBefore);

  const readings: Reading[] = [
    reading("spend", "Investimento", "money", true, spendM.value, spendBM.value, { neutral: true, why: spendM.why }),
    reading("revenue", "Faturamento", "money", true, revM.value, revBM.value, { why: revM.value === null && !mixed ? eventWhy("no_events") : revM.why }),
    reading("leads", "Leads", "number", true, leadsNow, leadsBefore, { why: "mixed_events" }),
    reading("conversations", "Conversas por mensagem iniciadas", "number", true, conversationsNow, conversationsBefore, { why: "not_collected" }),
    reading("direct_leads", "Leads gerados", "number", true, directNow, directBefore, { why: mixedDirectEvents ? "mixed_events" : "not_collected" }),
    reading("direct_cpl", "CPL", "money", false, mixed ? null : cplOf(spendNow, directNow), mixed || spendBefore === null ? null : cplOf(spendBefore, directBefore), { why: mixed ? "mixed_currency" : "no_base" }),
    reading("cost_per_conversation", "Custo por conversa", "money", false, mixed ? null : cplOf(spendNow, conversationsNow), mixed || spendBefore === null ? null : cplOf(spendBefore, conversationsBefore), { why: mixed ? "mixed_currency" : "no_base" }),
    reading("purchases", "Compras", "number", true, purchasesNow, purchasesBefore, { why: eventWhy("no_events") }),
    reading("roas", "ROAS", "ratio", true, mixed ? null : div(valueNow, spendNow), mixed ? null : div(valueBefore, spendBefore), { why: mixed ? "mixed_currency" : valueNow === null ? eventWhy("no_events") : "no_base" }),
    reading("cpl", "CPL", "money", false, mixed || leadsNow === null ? null : cplOf(spendNow, leadsNow), mixed || spendBefore === null || leadsBefore === null ? null : cplOf(spendBefore, leadsBefore), { why: mixed ? "mixed_currency" : mixedLeadEvents ? "mixed_events" : "no_base" }),
    reading("cpa", "CPA", "money", false, mixed ? null : div(spendNow, purchasesNow), mixed ? null : div(spendBefore, purchasesBefore), { why: mixed ? "mixed_currency" : purchasesNow === null ? eventWhy("no_events") : "no_base" }),
    reading("cpc", "CPC", "money", false, mixed ? null : div(spendNow, clicksNow), mixed ? null : div(spendBefore, clicksBefore), { neutral: true, why: mixed ? "mixed_currency" : "no_base" }),
    reading("ctr", "CTR", "percent", true, div(clicksNow * 100, imprNow), div(clicksBefore === null ? null : clicksBefore * 100, imprBefore), { neutral: true, why: "no_base" }),
  ];
  return { status, currency, readings: readings.map((r) => ({ ...r, currency })) };
}
