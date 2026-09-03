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
import { buildLostReasonBreakdown } from "@/lib/dashboard/queries";
import { isKnownLostReason } from "@/lib/deals/lost-reason";
import { XCircle } from "lucide-react";

interface LostReasonCardProps {
  deals: Deal[];
}

export function LostReasonCard({ deals }: LostReasonCardProps) {
  const t = useTranslations("Dashboard.lostReasons");
  const tDetail = useTranslations("Pipelines.detail");
  const { defaultCurrency } = useAuth();

  const breakdown = useMemo(() => buildLostReasonBreakdown(deals), [deals]);

  function label(reason: string | null): string {
    if (!reason) return t("notInformed");
    return isKnownLostReason(reason) ? tDetail(`lostReason_${reason}` as Parameters<typeof tDetail>[0]) : reason;
  }

  const chartData = breakdown.map((row) => ({
    reason: label(row.reason),
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
          <EmptyState icon={XCircle} title={t("noData")} />
        ) : (
          <div className="space-y-4">
            <BarChart
              data={chartData}
              index="reason"
              categories={[t("countLabel")]}
              colors={["amber"]}
              layout="horizontal"
              valueFormatter={(v) => formatCompactNumber(v)}
              className="h-56"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">{t("colReason")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colDeals")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colPercent")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colValue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.map((row) => (
                    <TableRow key={row.reason ?? "none"} className="border-border">
                      <TableCell className="text-foreground">{label(row.reason)}</TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.percent.toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {formatCurrency(row.totalValue, defaultCurrency)}
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
