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
  /** The closed contract (deal) the commission came from. */
  deal_id?: string | null;
  deal_title?: string | null;
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

/** One closed contract under a person, with its commission in the month it falls due. */
export interface CommissionGridItem {
  key: string;
  dealId: string | null;
  /** "00357 - First response group" */
  label: string;
  /** Earliest due date, YYYY-MM-DD. */
  dueDate: string;
  /** index 0 = January */
  months: number[];
  total: number;
}

export interface CommissionGridRow {
  recipient: string;
  /** index 0 = January */
  months: number[];
  total: number;
  items: CommissionGridItem[];
}

export interface CommissionGrid {
  rows: CommissionGridRow[];
  monthTotals: number[];
  grandTotal: number;
}

type GridItemAcc = Omit<CommissionGridItem, "months" | "total"> & { cents: number[] };

/** One row per person (with one line per contract under it), twelve month columns, with row/column/grand totals. Sums in whole cents. */
export function buildCommissionGrid(rows: CommissionRow[], year: number): CommissionGrid {
  const byPerson = new Map<string, { cents: number[]; items: Map<string, GridItemAcc> }>();
  for (const r of rows) {
    if (yearOf(r.due_date) !== year) continue;
    const person = byPerson.get(r.recipient_name) ?? { cents: new Array(12).fill(0), items: new Map() };
    person.cents[monthOf(r.due_date) - 1] += toCents(r.amount);
    // One line per contract; a contract without a deal link stays on its own line.
    const key = r.deal_id ?? r.id;
    const item = person.items.get(key) ?? {
      key,
      dealId: r.deal_id ?? null,
      label: displayClient(r.deal_title || r.client_label),
      dueDate: r.due_date,
      cents: new Array(12).fill(0),
    };
    item.cents[monthOf(r.due_date) - 1] += toCents(r.amount);
    if (r.due_date < item.dueDate) item.dueDate = r.due_date;
    person.items.set(key, item);
    byPerson.set(r.recipient_name, person);
  }
  const gridRows: CommissionGridRow[] = [...byPerson.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([recipient, { cents, items }]) => ({
      recipient,
      months: cents.map((c) => c / 100),
      total: cents.reduce((s, c) => s + c, 0) / 100,
      items: [...items.values()]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label))
        .map(({ cents: itemCents, ...item }) => ({
          ...item,
          months: itemCents.map((c) => c / 100),
          total: itemCents.reduce((sum, c) => sum + c, 0) / 100,
        })),
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
