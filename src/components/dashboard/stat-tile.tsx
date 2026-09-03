"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Small metric tile — extracted from `PipelineAnalytics`'s local `Metric()`
 * so the Dashboard's new Performance/Atenção groups can reuse the exact
 * same visual language instead of inventing a new tile style.
 */
export function StatTile({
  icon,
  label,
  value,
  tooltip,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tooltip?: string;
  onClick?: () => void;
}) {
  const t = useTranslations("Pipelines.analytics");
  const Wrapper = onClick ? "button" : "div";

  return (
    <TooltipProvider>
      <Wrapper
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "rounded-lg bg-muted/50 p-3 text-left",
          onClick && "cursor-pointer transition-colors hover:bg-muted",
        )}
      >
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {icon}
          <span>{label}</span>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t("howCalculated", { label })}
                    className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
                  />
                }
              >
                <Info className="h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-left">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
      </Wrapper>
    </TooltipProvider>
  );
}
