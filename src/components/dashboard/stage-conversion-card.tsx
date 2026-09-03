"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { StageFunnelStep } from "@/lib/dashboard/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart } from "@/components/tremor/bar-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { GitBranch } from "lucide-react";

interface StageConversionCardProps {
  funnel: StageFunnelStep[];
}

export function StageConversionCard({ funnel }: StageConversionCardProps) {
  const t = useTranslations("Dashboard.stageConversion");

  const withData = funnel.filter((s) => s.conversionRate !== null && s.hasEnoughData);
  const chartData = useMemo(
    () => withData.map((s) => ({ stage: s.stageName, [t("rateLabel")]: Math.round(s.conversionRate as number) })),
    [withData, t],
  );

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">{t("title")}</CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {withData.length === 0 ? (
          <EmptyState icon={GitBranch} title={t("collecting")} hint={t("collectingHint")} />
        ) : (
          <div className="space-y-4">
            <BarChart
              data={chartData}
              index="stage"
              categories={[t("rateLabel")]}
              colors={["violet"]}
              valueFormatter={(v) => `${v}%`}
              className="h-56"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">{t("colStage")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colEntered")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colConversion")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funnel
                    .filter((s) => s.conversionRate !== null)
                    .map((s) => (
                      <TableRow key={s.stageId} className="border-border">
                        <TableCell className="text-foreground">{s.stageName}</TableCell>
                        <TableCell className="text-right tabular-nums text-foreground">{s.enteredCount}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {s.hasEnoughData ? `${Math.round(s.conversionRate as number)}%` : t("insufficientData")}
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
