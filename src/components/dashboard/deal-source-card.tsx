"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Deal } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart } from "@/components/tremor/bar-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, formatCompactNumber } from "@/lib/currency";
import { buildDealSourceBreakdown } from "@/lib/dashboard/queries";
import { isKnownDealOrigin } from "@/lib/deals/origin";
import { Radar } from "lucide-react";

interface DealSourceCardProps {
  deals: Deal[];
}

export function DealSourceCard({ deals }: DealSourceCardProps) {
  const t = useTranslations("Dashboard.dealSource");
  const tOrigin = useTranslations("Pipelines.origin");
  const { defaultCurrency } = useAuth();

  const breakdown = useMemo(() => buildDealSourceBreakdown(deals), [deals]);

  function label(origin: string | null): string {
    if (!origin) return tOrigin("notInformed");
    return isKnownDealOrigin(origin) ? tOrigin(origin as Parameters<typeof tOrigin>[0]) : origin;
  }

  const chartData = breakdown.map((row) => ({
    origin: label(row.origin),
    [t("countLabel")]: row.count,
  }));

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">{t("title")}</CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {breakdown.length === 0 ? (
          <EmptyState icon={Radar} title={t("noData")} />
        ) : (
          <div className="space-y-4">
            <BarChart
              data={chartData}
              index="origin"
              categories={[t("countLabel")]}
              colors={["violet"]}
              valueFormatter={(v) => formatCompactNumber(v)}
              className="h-56"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">{t("colOrigin")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colDeals")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colPercent")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colValue")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colWon")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colWonValue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.map((row) => (
                    <TableRow key={row.origin ?? "none"} className="border-border">
                      <TableCell className="text-foreground">{label(row.origin)}</TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.percent.toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {formatCurrency(row.totalValue, defaultCurrency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">{row.wonCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {formatCurrency(row.wonValue, defaultCurrency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
