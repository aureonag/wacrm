"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Deal } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { buildNewMrr } from "@/lib/dashboard/queries";
import { getPeriodRange } from "@/lib/dashboard/period";
import { TrendingUp } from "lucide-react";

interface NewMrrCardProps {
  /** Deals for the whole pipeline, unfiltered by the top period picker —
   *  MRR is always "this calendar month", per the spec (a metric like this
   *  read against "today"/"week" would be conceptually wrong). */
  deals: Deal[];
}

export function NewMrrCard({ deals }: NewMrrCardProps) {
  const t = useTranslations("Dashboard.newMrr");
  const { defaultCurrency } = useAuth();

  const result = useMemo(() => buildNewMrr(deals, getPeriodRange("month")), [deals]);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-emerald-400">
          +{formatCurrency(result.totalMrr, defaultCurrency)}
          <span className="text-sm font-normal text-muted-foreground">{t("perMonthSuffix")}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("wonCount", { count: result.wonCount })}</p>
      </CardContent>
    </Card>
  );
}
