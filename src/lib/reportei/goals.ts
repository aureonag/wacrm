// Client goals: a monthly ad budget and a maximum CPC. Pure helpers: validation
// of the form and the status shown as badges on the Dashboards overview.

export interface Goals {
  monthlyBudget: number | null;
  maxCpc: number | null;
}

export const NO_GOALS: Goals = { monthlyBudget: null, maxCpc: null };
const LIMIT = 1_000_000_000;

/** A positive amount with up to 2 decimals; empty or null means "no goal". `undefined` when the value is invalid. */
function amount(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= LIMIT) return undefined;
  return Math.round(n * 100) / 100;
}

/** Goals from untrusted input (the form), or null when a value is invalid. */
export function parseGoals(input: unknown): Goals | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  const monthlyBudget = amount(o.monthlyBudget);
  const maxCpc = amount(o.maxCpc);
  if (monthlyBudget === undefined || maxCpc === undefined) return null;
  return { monthlyBudget, maxCpc };
}

export type BudgetStatus = "ok" | "attention" | "over";

export interface BudgetProgress {
  /** Spent so far as a percent of the monthly budget (can pass 100). */
  percent: number;
  /** How much of the month has gone by, as a percent. */
  monthPercent: number;
  status: BudgetStatus;
}

/** Days in the month of `today` (YYYY-MM-DD) and which day of it it is. */
function monthDays(today: string): { day: number; total: number } {
  const [y, m, d] = today.split("-").map(Number);
  return { day: d, total: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

/**
 * Where the spend of the current month stands against the budget: "over" at or
 * past 100%, "attention" when spending ahead of the calendar by more than 15
 * points, otherwise "ok". Null without a budget.
 */
export function budgetProgress(spend: number, budget: number | null, today: string): BudgetProgress | null {
  if (budget === null || !(budget > 0) || !Number.isFinite(spend)) return null;
  const percent = (spend / budget) * 100;
  const { day, total } = monthDays(today);
  const monthPercent = (day / total) * 100;
  const status: BudgetStatus = percent >= 100 ? "over" : percent > monthPercent + 15 ? "attention" : "ok";
  return { percent, monthPercent, status };
}

/** "over" when the CPC is above the goal, "ok" when within it, null without a goal or without clicks. */
export function cpcStatus(cpc: number, max: number | null, clicks: number): "ok" | "over" | null {
  if (max === null || !(max > 0) || clicks <= 0 || !Number.isFinite(cpc)) return null;
  return cpc > max ? "over" : "ok";
}

interface GoalRow {
  monthly_budget: number | string | null;
  max_cpc: number | string | null;
}

/** Database numerics arrive as numbers or strings. */
export function goalsFromRow(row: GoalRow | null | undefined): Goals {
  if (!row) return NO_GOALS;
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return { monthlyBudget: num(row.monthly_budget), maxCpc: num(row.max_cpc) };
}

export interface GoalReading {
  /** Only for the current month ("this_month"): the budget is monthly, other periods do not match it. */
  budget: BudgetProgress | null;
  cpc: "ok" | "over" | null;
}

/**
 * What a client's goals say about the numbers on screen. Money goals do not apply
 * when the accounts are in different currencies (the totals are not summed then).
 */
export function readGoals(
  summary: { totals: { spend: number; clicks: number; cpc: number } | null; mixedCurrency: boolean },
  goals: Goals | undefined,
  periodKey: string,
  today: string,
): GoalReading {
  if (!goals || !summary.totals || summary.mixedCurrency) return { budget: null, cpc: null };
  return {
    budget: periodKey === "this_month" ? budgetProgress(summary.totals.spend, goals.monthlyBudget, today) : null,
    cpc: cpcStatus(summary.totals.cpc, goals.maxCpc, summary.totals.clicks),
  };
}
