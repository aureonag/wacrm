// CSV for the Dashboards overview, made to open in Excel in Brazil: `;` as the
// separator, comma decimals, a UTF-8 BOM, and CRLF line breaks. Pure.

import type { ClientSummary } from "@/lib/reportei/dashboard";
import { change } from "@/lib/reportei/dashboard";

const BOM = "﻿";

/** A cell, quoted when needed. Text that a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value).replace(".", ",") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const round = (n: number | null, digits = 2) => (n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits);

export interface CsvLabels {
  client: string;
  code: string;
  accounts: string;
  spend: string;
  clicks: string;
  ctr: string;
  cpc: string;
  /** "spend" → "Gasto vs. anterior (%)" etc. */
  versus: (metric: string) => string;
}

/** The overview rows as a CSV string. Money columns stay empty for clients whose accounts mix currencies. */
export function summariesToCsv(rows: readonly ClientSummary[], labels: CsvLabels): string {
  const header = [labels.client, labels.code, labels.accounts, labels.spend, labels.versus(labels.spend), labels.clicks, labels.versus(labels.clicks), labels.ctr, labels.versus(labels.ctr), labels.cpc, labels.versus(labels.cpc)];
  const lines = [header.map(csvCell).join(";")];
  for (const r of rows) {
    const t = r.totals;
    const money = !r.mixedCurrency;
    lines.push(
      [
        r.name,
        r.code,
        `${r.readable}/${r.accounts}`,
        t && money ? round(t.spend) : null,
        money ? round(change(r, "spend"), 1) : null,
        t ? t.clicks : null,
        round(change(r, "clicks"), 1),
        t ? round(t.ctr) : null,
        round(change(r, "ctr"), 1),
        t && money ? round(t.cpc) : null,
        money ? round(change(r, "cpc"), 1) : null,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return BOM + lines.join("\r\n") + "\r\n";
}
