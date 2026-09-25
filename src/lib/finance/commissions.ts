// Pure grouping for the Financeiro "Comissões" tab (kept out of the
// component so the date/sum logic is unit-tested).

import { parseDealTitle } from "./closing";

export interface CommissionRow {
  id: string;
  recipient_name: string;
  client_label: string;
  pct: number;
  base_amount: number;
  amount: number;
  /** YYYY-MM-DD */
  due_date: string;
}

const toCents = (n: number) => Math.round(n * 100);

function monthOf(dueDate: string): number {
  return Number(dueDate.slice(5, 7));
}
function yearOf(dueDate: string): number {
  return Number(dueDate.slice(0, 4));
}

/** Commissions due in a given month, earliest day first (ties by name). */
export function commissionsInMonth(rows: CommissionRow[], year: number, month: number): CommissionRow[] {
  return rows
    .filter((r) => yearOf(r.due_date) === year && monthOf(r.due_date) === month)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.recipient_name.localeCompare(b.recipient_name));
}

export interface CommissionGridRow {
  recipient: string;
  /** index 0 = January */
  months: number[];
  total: number;
}

export interface CommissionGrid {
  rows: CommissionGridRow[];
  monthTotals: number[];
  grandTotal: number;
}

/** One row per person, twelve month columns, with row/column/grand totals. Sums in whole cents. */
export function buildCommissionGrid(rows: CommissionRow[], year: number): CommissionGrid {
  const byPerson = new Map<string, number[]>();
  for (const r of rows) {
    if (yearOf(r.due_date) !== year) continue;
    const cents = byPerson.get(r.recipient_name) ?? new Array(12).fill(0);
    cents[monthOf(r.due_date) - 1] += toCents(r.amount);
    byPerson.set(r.recipient_name, cents);
  }
  const gridRows: CommissionGridRow[] = [...byPerson.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([recipient, cents]) => ({
      recipient,
      months: cents.map((c) => c / 100),
      total: cents.reduce((s, c) => s + c, 0) / 100,
    }));
  const monthCents = new Array(12).fill(0);
  for (const row of gridRows) row.months.forEach((v, i) => (monthCents[i] += toCents(v)));
  return {
    rows: gridRows,
    monthTotals: monthCents.map((c) => c / 100),
    grandTotal: monthCents.reduce((s, c) => s + c, 0) / 100,
  };
}

/** "99999 - ZZ Cliente | complemento" -> "99999 - ZZ Cliente". */
export function displayClient(label: string): string {
  const { code, name } = parseDealTitle(label);
  return code ? `${code} - ${name}` : name;
}

/** "2026-10-15" -> "15/10". */
export function formatDayMonth(dueDate: string): string {
  return `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}`;
}
