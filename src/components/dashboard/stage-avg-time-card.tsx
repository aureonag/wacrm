"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { StageFunnelStep } from "@/lib/dashboard/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart } from "@/components/tremor/bar-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import { Timer } from "lucide-react";

interface StageAvgTimeCardProps {
  funnel: StageFunnelStep[];
}

/** A stage counts as a bottleneck once its average dwell time is at least
 *  1.5x the average across every stage that has enough data — a simple,
 *  visible threshold rather than a statistical test. */
const BOTTLENECK_FACTOR = 1.5;

export function StageAvgTimeCard({ funnel }: StageAvgTimeCardProps) {
  const t = useTranslations("Dashboard.stageAvgTime");

  const withData = funnel.filter((s) => s.avgDaysInStage !== null && s.hasEnoughData);
  const overallAvg = withData.length > 0
    ? withData.reduce((sum, s) => sum + (s.avgDaysInStage as number), 0) / withData.length
    : 0;

  const chartData = useMemo(
    () => withData.map((s) => ({ stage: s.stageName, [t("daysLabel")]: Math.round((s.avgDaysInStage as number) * 10) / 10 })),
    [withData, t],
  );

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Timer className="h-4 w-4 text-blue-400" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {withData.length === 0 ? (
          <EmptyState icon={Timer} title={t("collecting")} hint={t("collectingHint")} />
        ) : (
          <div className="space-y-4">
            <BarChart
              data={chartData}
              index="stage"
              categories={[t("daysLabel")]}
              colors={["blue"]}
              layout="horizontal"
              valueFormatter={(v) => t("days", { count: v })}
              className="h-56"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">{t("colStage")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colAvgTime")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funnel.map((s) => {
                    const isBottleneck =
                      s.hasEnoughData && s.avgDaysInStage !== null && overallAvg > 0 && s.avgDaysInStage >= overallAvg * BOTTLENECK_FACTOR;
                    return (
                      <TableRow key={s.stageId} className="border-border">
                        <TableCell className="text-foreground">{s.stageName}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            isBottleneck ? "font-semibold text-amber-400" : "text-muted-foreground",
                          )}
                        >
                          {!s.hasEnoughData || s.avgDaysInStage === null
                            ? t("insufficientData")
                            : t("days", { count: Math.round(s.avgDaysInStage * 10) / 10 })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
