'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { formatCurrency, formatCompactNumber } from '@/lib/currency';
import { getYearOptions } from '@/lib/finance/period';
import { MONTH_NAMES_PT } from '@/lib/finance/types';
import type { FinServiceLine } from '@/lib/finance/types';
import { BarChart } from '@/components/tremor/bar-chart';

const selectClass =
  'h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary';

interface MonthRow {
  month: number;
  revenue: number;
  teamCost: number;
  expenses: number;
  profit: number;
  growthPct: number | null;
}

interface LineRow {
  id: string;
  name: string;
  revenue: number;
  teamCost: number;
  profit: number;
  marginPct: number | null;
}

function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/**
 * Visão geral — the "Balanço" rollup: per-month revenue/cost/expenses/
 * profit for the whole account, plus an annual breakdown per service
 * line. Computed client-side from the raw rows (small dataset — a
 * private internal ledger, not a data-warehouse job) rather than via a
 * SQL view, so the aggregation logic stays readable in one place.
 */
export function OverviewTab() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [lineRows, setLineRows] = useState<LineRow[]>([]);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);

    const [linesRes, clientsRes, allocRes, expensesRes] = await Promise.all([
      supabase
        .from('fin_service_lines')
        .select('id, name')
        .order('sort_order')
        .order('name'),
      supabase.from('fin_clients').select('id, service_line_id'),
      supabase
        .from('fin_team_allocations')
        .select('service_line_id, month, amount')
        .eq('year', year),
      supabase.from('fin_expenses').select('month, amount').eq('year', year),
    ]);

    const lines =
      (linesRes.data as Pick<FinServiceLine, 'id' | 'name'>[] | null) ?? [];
    const clients =
      (clientsRes.data as { id: string; service_line_id: string }[] | null) ??
      [];
    const clientIds = clients.map((c) => c.id);

    const { data: valueRows } =
      clientIds.length > 0
        ? await supabase
            .from('fin_client_values')
            .select('client_id, month, amount')
            .eq('year', year)
            .in('client_id', clientIds)
        : {
            data: [] as { client_id: string; month: number; amount: number }[],
          };

    const clientToLine = new Map(clients.map((c) => [c.id, c.service_line_id]));
    const allocations =
      (allocRes.data as
        { service_line_id: string; month: number; amount: number }[] | null) ??
      [];
    const expenses =
      (expensesRes.data as { month: number; amount: number }[] | null) ?? [];

    // Per-line, per-month accumulators.
    const lineMonthRevenue = new Map<string, number[]>();
    const lineMonthCost = new Map<string, number[]>();
    for (const line of lines) {
      lineMonthRevenue.set(line.id, Array(13).fill(0));
      lineMonthCost.set(line.id, Array(13).fill(0));
    }

    for (const v of (valueRows as
      { client_id: string; month: number; amount: number }[] | null) ?? []) {
      const lineId = clientToLine.get(v.client_id);
      if (!lineId || !lineMonthRevenue.has(lineId)) continue;
      lineMonthRevenue.get(lineId)![v.month] += Number(v.amount) || 0;
    }
    for (const a of allocations) {
      if (!lineMonthCost.has(a.service_line_id)) continue;
      lineMonthCost.get(a.service_line_id)![a.month] += Number(a.amount) || 0;
    }

    const monthExpenses = Array(13).fill(0);
    for (const e of expenses) monthExpenses[e.month] += Number(e.amount) || 0;

    const monthRows: MonthRow[] = [];
    let prevRevenue: number | null = null;
    for (let m = 1; m <= 12; m++) {
      let revenue = 0;
      let teamCost = 0;
      for (const line of lines) {
        revenue += lineMonthRevenue.get(line.id)![m];
        teamCost += lineMonthCost.get(line.id)![m];
      }
      const exp = monthExpenses[m];
      const profit = revenue - teamCost - exp;
      const growthPct =
        prevRevenue && prevRevenue > 0
          ? ((revenue - prevRevenue) / prevRevenue) * 100
          : null;
      monthRows.push({
        month: m,
        revenue,
        teamCost,
        expenses: exp,
        profit,
        growthPct,
      });
      prevRevenue = revenue;
    }

    const lineSummaries: LineRow[] = lines.map((line) => {
      const revenue = lineMonthRevenue.get(line.id)!.reduce((s, v) => s + v, 0);
      const teamCost = lineMonthCost.get(line.id)!.reduce((s, v) => s + v, 0);
      const profit = revenue - teamCost;
      return {
        id: line.id,
        name: line.name,
        revenue,
        teamCost,
        profit,
        marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
      };
    });

    setMonths(monthRows);
    setLineRows(lineSummaries);
    setLoading(false);
  }, [supabase, accountId, year]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const totalTeamCost = months.reduce((s, m) => s + m.teamCost, 0);
  const totalExpenses = months.reduce((s, m) => s + m.expenses, 0);
  const totalProfit = months.reduce((s, m) => s + m.profit, 0);

  const monthChartData = months.map((row) => ({
    month: MONTH_NAMES_PT[row.month - 1].slice(0, 3),
    Faturamento: row.revenue,
    'Custo de time': row.teamCost,
    Despesas: row.expenses,
  }));
  const profitChartData = months.map((row) => ({
    month: MONTH_NAMES_PT[row.month - 1].slice(0, 3),
    Sobra: row.profit,
  }));
  const lineChartData = [...lineRows]
    .sort((a, b) => b.revenue - a.revenue)
    .map((row) => ({ line: row.name, Faturamento: row.revenue }));

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={selectClass}
        >
          {getYearOptions().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Faturamento no ano</p>
            <p className="text-foreground mt-1 text-lg font-semibold">
              {formatCurrency(totalRevenue, 'BRL')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">
              Custo de time no ano
            </p>
            <p className="text-foreground mt-1 text-lg font-semibold">
              {formatCurrency(totalTeamCost, 'BRL')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Despesas no ano</p>
            <p className="text-foreground mt-1 text-lg font-semibold">
              {formatCurrency(totalExpenses, 'BRL')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Sobra no ano</p>
            <p
              className={`mt-1 text-lg font-semibold ${totalProfit >= 0 ? 'text-foreground' : 'text-destructive'}`}
            >
              {formatCurrency(totalProfit, 'BRL')}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-foreground">
              Faturamento, custo e despesas por mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={monthChartData}
              index="month"
              categories={['Faturamento', 'Custo de time', 'Despesas']}
              colors={['violet', 'amber', 'pink']}
              valueFormatter={(v) => formatCompactNumber(v)}
              className="h-72"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Sobra por mês</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={profitChartData}
              index="month"
              categories={['Sobra']}
              colors={['emerald']}
              valueFormatter={(v) => formatCompactNumber(v)}
              showLegend={false}
              className="h-72"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Balanço mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead>Faturamento</TableHead>
                <TableHead>Custo de time</TableHead>
                <TableHead>Despesas</TableHead>
                <TableHead>Sobra</TableHead>
                <TableHead>Crescimento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="text-foreground">
                    {MONTH_NAMES_PT[row.month - 1]}
                  </TableCell>
                  <TableCell>{formatCurrency(row.revenue, 'BRL')}</TableCell>
                  <TableCell>{formatCurrency(row.teamCost, 'BRL')}</TableCell>
                  <TableCell>{formatCurrency(row.expenses, 'BRL')}</TableCell>
                  <TableCell
                    className={
                      row.profit >= 0 ? 'text-foreground' : 'text-destructive'
                    }
                  >
                    {formatCurrency(row.profit, 'BRL')}
                  </TableCell>
                  <TableCell
                    className={
                      row.growthPct !== null && row.growthPct < 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }
                  >
                    {pct(row.growthPct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">
            Por linha de serviço ({year})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lineRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma linha de serviço cadastrada ainda.
            </p>
          ) : (
            <>
              <BarChart
                data={lineChartData}
                index="line"
                categories={['Faturamento']}
                colors={['cyan']}
                valueFormatter={(v) => formatCompactNumber(v)}
                layout="vertical"
                showLegend={false}
                className="mb-4 h-48"
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead>Faturamento</TableHead>
                    <TableHead>Custo de time</TableHead>
                    <TableHead>Margem</TableHead>
                    <TableHead>Margem %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-foreground">
                        {row.name}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(row.revenue, 'BRL')}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(row.teamCost, 'BRL')}
                      </TableCell>
                      <TableCell
                        className={
                          row.profit >= 0
                            ? 'text-foreground'
                            : 'text-destructive'
                        }
                      >
                        {formatCurrency(row.profit, 'BRL')}
                      </TableCell>
                      <TableCell>{pct(row.marginPct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
