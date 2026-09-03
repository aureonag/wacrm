"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Deal } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatTile } from "@/components/dashboard/stat-tile";
import { buildAvgTimeToClose, buildConversionRate, buildWinLossRate } from "@/lib/dashboard/queries";
import type { DateRange } from "@/lib/dashboard/period";
import { Percent, Timer, Trophy, XCircle } from "lucide-react";

interface PerformanceSummaryCardProps {
  deals: Deal[];
  range: DateRange;
}

export function PerformanceSummaryCard({ deals, range }: PerformanceSummaryCardProps) {
  const t = useTranslations("Dashboard.performance");

  const conversion = useMemo(() => buildConversionRate(deals, range), [deals, range]);
  const winLoss = useMemo(() => buildWinLossRate(deals, range), [deals, range]);
  const avgTimeToClose = useMemo(() => buildAvgTimeToClose(deals, range), [deals, range]);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              icon={<Percent className="h-4 w-4 text-primary" />}
              label={t("conversionRate")}
              value={`${conversion.rate.toFixed(0)}%`}
              tooltip={t("conversionRateTooltip", {
                won: conversion.wonCount,
                total: conversion.cohortSize,
              })}
            />
            <StatTile
              icon={<Timer className="h-4 w-4 text-blue-400" />}
              label={t("avgTimeToClose")}
              value={avgTimeToClose.avgDays === null ? "—" : t("days", { count: Math.round(avgTimeToClose.avgDays) })}
              tooltip={t("avgTimeToCloseTooltip")}
            />
            <StatTile
              icon={<Trophy className="h-4 w-4 text-emerald-400" />}
              label={t("winRate")}
              value={`${winLoss.winRate.toFixed(0)}%`}
              tooltip={t("winRateTooltip", { count: winLoss.wonCount })}
            />
            <StatTile
              icon={<XCircle className="h-4 w-4 text-red-400" />}
              label={t("lossRate")}
              value={`${winLoss.lossRate.toFixed(0)}%`}
              tooltip={t("lossRateTooltip", { count: winLoss.lostCount })}
            />
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
