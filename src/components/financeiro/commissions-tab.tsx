"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { getYearOptions } from "@/lib/finance/period";
import { MONTH_NAMES_PT } from "@/lib/finance/types";
import {
  buildCommissionGrid,
  commissionsInMonth,
  displayClient,
  formatDayMonth,
  type CommissionRow,
} from "@/lib/finance/commissions";

const selectClass =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_SHORT = MONTH_NAMES_PT.map((n) => n.slice(0, 3));

/**
 * Comissões — who is owed a commission and when. Policy: the seller gets
 * the client's first monthly fee, paid the day the client pays it, so each
 * row's due date is the first payment date typed in the closing sheet.
 * Read-only: rows are created by the closing sheet (close_deal_with_sheet).
 */
export function CommissionsTab() {
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ year: number; rows: CommissionRow[]; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase
        .from("fin_commissions")
        .select("id, recipient_name, client_label, pct, base_amount, amount, due_date")
        .gte("due_date", `${year}-01-01`)
        .lte("due_date", `${year}-12-31`)
        .order("due_date");
      if (cancelled) return;
      setData({
        year,
        failed: !!error,
        rows: (rows ?? []).map((r) => ({
          ...r,
          pct: Number(r.pct),
          base_amount: Number(r.base_amount),
          amount: Number(r.amount),
        })) as CommissionRow[],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, year]);

  const loading = data?.year !== year;
  const rows = useMemo(() => (data?.year === year ? data.rows : []), [data, year]);
  const monthRows = useMemo(() => commissionsInMonth(rows, year, month), [rows, year, month]);
  const monthTotal = monthRows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) / 100;
  const grid = useMemo(() => buildCommissionGrid(rows, year), [rows, year]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
          {getYearOptions().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {MONTHS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonth(m)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                m === month
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {MONTH_SHORT[m - 1]}
            </button>
          ))}
        </div>
      </div>

      {data?.failed && (
        <p className="text-sm text-red-400">Não foi possível carregar as comissões. Recarregue a página.</p>
      )}

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">
            A pagar em {MONTH_NAMES_PT[month - 1]} de {year}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A comissão é a primeira mensalidade paga pelo cliente e vence no dia em que ele paga.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : monthRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma comissão vence neste mês.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Dia</TableHead>
                  <TableHead>Quem recebe</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Primeira mensalidade</TableHead>
                  <TableHead className="w-16 text-right">%</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-foreground tabular-nums">{formatDayMonth(r.due_date)}</TableCell>
                    <TableCell className="text-foreground">{r.recipient_name}</TableCell>
                    <TableCell className="text-muted-foreground">{displayClient(r.client_label)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(r.base_amount, "BRL")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.pct}%</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">
                      {formatCurrency(r.amount, "BRL")}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-primary/10 hover:bg-primary/10">
                  <TableCell colSpan={5} className="text-right text-xs font-semibold text-foreground">
                    Total do mês
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-foreground">
                    {formatCurrency(monthTotal, "BRL")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Comissões mês a mês — {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : grid.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma comissão neste ano.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-[180px] bg-card">Pessoa</TableHead>
                    {MONTHS.map((m) => (
                      <TableHead
                        key={m}
                        className={`text-right ${m === month ? "text-primary" : ""}`}
                      >
                        {MONTH_SHORT[m - 1]}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-primary/10 hover:bg-primary/10">
                    <TableCell className="sticky left-0 z-10 bg-card px-2 py-2 text-xs font-semibold text-foreground">
                      Total do mês
                    </TableCell>
                    {grid.monthTotals.map((v, i) => (
                      <TableCell key={i} className="px-1.5 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                        {v > 0 ? formatCurrency(v, "BRL") : "—"}
                      </TableCell>
                    ))}
                    <TableCell className="px-1.5 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                      {formatCurrency(grid.grandTotal, "BRL")}
                    </TableCell>
                  </TableRow>
                  {grid.rows.map((row) => (
                    <TableRow key={row.recipient}>
                      <TableCell className="sticky left-0 z-10 bg-card text-sm text-foreground">{row.recipient}</TableCell>
                      {row.months.map((v, i) => (
                        <TableCell key={i} className="px-1.5 text-right text-xs tabular-nums text-muted-foreground">
                          {v > 0 ? formatCurrency(v, "BRL") : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="px-1.5 text-right text-xs font-semibold tabular-nums text-foreground">
                        {formatCurrency(row.total, "BRL")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
