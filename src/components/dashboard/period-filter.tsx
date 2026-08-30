"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange, PeriodKind } from "@/lib/dashboard/period";

const KINDS: PeriodKind[] = ["today", "yesterday", "week", "month", "custom"];

interface PeriodFilterProps {
  kind: PeriodKind;
  custom: DateRange | null;
  onChange: (kind: PeriodKind, custom?: DateRange) => void;
}

// A native <input type="date"> already renders the browser's own
// calendar — reaching for a date-picker library just to get "pick a
// start and end day" would be a new dependency for zero extra function.
export function PeriodFilter({ kind, custom, onChange }: PeriodFilterProps) {
  const t = useTranslations("Dashboard.periodFilter");
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(toInputValue(custom?.start));
  const [draftEnd, setDraftEnd] = useState(toInputValue(custom?.end));

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    onChange("custom", { start: new Date(draftStart), end: new Date(draftEnd) });
    setOpen(false);
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {KINDS.map((k) =>
        k === "custom" ? (
          <Popover key={k} open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    kind === "custom"
                      ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t("custom")}
                </button>
              }
            />
            <PopoverContent align="end" className="w-72 border-border bg-popover p-4">
              <div className="flex flex-col gap-3">
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
        ) : (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              kind === k
                ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(k)}
          </button>
        ),
      )}
    </div>
  );
}

function toInputValue(d?: Date): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
