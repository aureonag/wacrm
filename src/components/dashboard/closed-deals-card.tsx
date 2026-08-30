"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Deal } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BarChart } from "@/components/tremor/bar-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, formatCompactNumber } from "@/lib/currency";
import {
  getReportingRange,
  monthSpan,
  MAX_CUSTOM_REPORTING_MONTHS,
  type ReportingKind,
} from "@/lib/dashboard/period";
import { buildClosedDealsByMonth } from "@/lib/dashboard/queries";
import { Trophy, CalendarRange } from "lucide-react";

const SELECT_KINDS: Exclude<ReportingKind, "custom">[] = [
  "q1",
  "q2",
  "q3",
  "q4",
  "h1",
  "h2",
  "year",
];

interface ClosedDealsCardProps {
  deals: Deal[];
}

export function ClosedDealsCard({ deals }: ClosedDealsCardProps) {
  const t = useTranslations("Dashboard.closedDeals");
  const locale = useLocale();
  const { defaultCurrency } = useAuth();

  const [kind, setKind] = useState<ReportingKind>("year");
  const [custom, setCustom] = useState<{ start: Date; end: Date } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const year = new Date().getFullYear();

  const range = useMemo(() => {
    if (kind === "custom" && custom) return custom;
    return getReportingRange(kind === "custom" ? "year" : kind, year);
  }, [kind, custom, year]);

  const buckets = useMemo(() => buildClosedDealsByMonth(deals, range), [deals, range]);

  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  const totalValue = buckets.reduce((sum, b) => sum + b.value, 0);

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short" }),
    [locale],
  );
  const spansMultipleYears =
    buckets.length > 0 &&
    buckets[0].month.getFullYear() !== buckets[buckets.length - 1]?.month.getFullYear();
  const chartData = buckets.map((b) => ({
    month: spansMultipleYears
      ? `${monthFormatter.format(b.month)} ${b.month.getFullYear()}`
      : monthFormatter.format(b.month),
    [t("valueLabel")]: b.value,
  }));

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    const start = new Date(draftStart);
    const end = new Date(draftEnd);
    const span = monthSpan({ start, end });
    if (span > MAX_CUSTOM_REPORTING_MONTHS) {
      setCustomError(t("rangeTooLong", { max: MAX_CUSTOM_REPORTING_MONTHS }));
      return;
    }
    setCustomError(null);
    setCustom({ start, end });
    setKind("custom");
    setPopoverOpen(false);
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-sm font-semibold text-foreground">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-xs">{t("description")}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={kind === "custom" ? undefined : kind} onValueChange={(v) => setKind(v as ReportingKind)}>
            <SelectTrigger className="w-40 border-border bg-muted text-foreground">
              <SelectValue>{kind === "custom" ? t("custom") : t(kind)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-border bg-popover text-popover-foreground">
              {SELECT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={t("custom")}
                  title={t("custom")}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground data-[popup-open]:bg-secondary"
                />
              }
            >
              <CalendarRange className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 border-border bg-popover p-4">
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-foreground">{t("custom")}</p>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("from")}
                  <input
                    type="date"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                    className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("to")}
                  <input
                    type="date"
                    value={draftEnd}
                    min={draftStart || undefined}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                {customError && <p className="text-xs text-red-400">{customError}</p>}
                <Button
                  size="sm"
                  disabled={!draftStart || !draftEnd}
                  onClick={applyCustom}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {t("apply")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent>
        {totalCount === 0 ? (
          <EmptyState icon={Trophy} title={t("noData")} />
        ) : (
          <>
            <div className="mb-4 flex gap-6">
              <div>
                <p className="text-xs text-muted-foreground">{t("dealsLabel")}</p>
                <p className="text-lg font-semibold text-foreground">{totalCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("valueLabel")}</p>
                <p className="text-lg font-semibold text-foreground">
                  {formatCurrency(totalValue, defaultCurrency)}
                </p>
              </div>
            </div>
            <BarChart
              data={chartData}
              index="month"
              categories={[t("valueLabel")]}
              colors={["violet"]}
              valueFormatter={(v) => formatCompactNumber(v)}
              className="h-56"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
