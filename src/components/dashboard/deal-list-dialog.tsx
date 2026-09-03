"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTranslations } from "next-intl";

export interface DealListDialogItem {
  id: string;
  title: string;
  meta?: string;
}

/**
 * Shared "click a metric, see the deals behind it" dialog — backs the
 * Dashboard's clickable stat tiles (negócios parados, follow-ups). Kept
 * generic (title + optional meta line) so both callers reuse it as-is.
 */
export function DealListDialog({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: DealListDialogItem[];
}) {
  const t = useTranslations("Dashboard.dealList");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
        </DialogHeader>
        {items.length === 0 ? (
          <EmptyState title={t("empty")} />
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/pipelines/deals/${item.id}`}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.meta && (
                    <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
