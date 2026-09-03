"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Deal } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatTile } from "@/components/dashboard/stat-tile";
import { DealListDialog, type DealListDialogItem } from "@/components/dashboard/deal-list-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { buildStalledDeals, selectStalledDeals } from "@/lib/dashboard/queries";
import { Clock } from "lucide-react";

interface StalledDealsCardProps {
  deals: Deal[];
}

export function StalledDealsCard({ deals }: StalledDealsCardProps) {
  const t = useTranslations("Dashboard.stalledDeals");
  const { defaultCurrency } = useAuth();
  const [openBucket, setOpenBucket] = useState<number | null>(null);

  const buckets = useMemo(() => buildStalledDeals(deals), [deals]);

  const dialogItems: DealListDialogItem[] = useMemo(() => {
    if (openBucket === null) return [];
    return selectStalledDeals(deals, openBucket).map((d) => ({
      id: d.id,
      title: d.title,
      meta: formatCurrency(d.value ?? 0, defaultCurrency),
    }));
  }, [openBucket, deals, defaultCurrency]);

  const hasAnyStalled = buckets.some((b) => b.count > 0);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-amber-400" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasAnyStalled ? (
          <EmptyState title={t("noneStalled")} />
        ) : (
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {buckets.map((bucket) => (
                <StatTile
                  key={bucket.minDays}
                  icon={<Clock className="h-4 w-4 text-amber-400" />}
                  label={t("bucketLabel", { days: bucket.minDays })}
                  value={String(bucket.count)}
                  tooltip={formatCurrency(bucket.totalValue, defaultCurrency)}
                  onClick={bucket.count > 0 ? () => setOpenBucket(bucket.minDays) : undefined}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>

      <DealListDialog
        open={openBucket !== null}
        onOpenChange={(v) => !v && setOpenBucket(null)}
        title={openBucket === null ? "" : t("bucketLabel", { days: openBucket })}
        items={dialogItems}
      />
    </Card>
  );
}
