"use client";

import type { Pipeline } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitBranch, ChevronDown, Settings } from "lucide-react";

interface PipelineSelectorProps {
  pipelines: Pipeline[];
  selectedId: string;
  onSelect: (id: string) => void;
  onManage?: () => void;
  placeholderLabel: string;
  emptyLabel: string;
  manageLabel: string;
}

// Shared between the Pipelines board and the per-pipeline Dashboard so
// switching pipelines looks and behaves identically in both places.
export function PipelineSelector({
  pipelines,
  selectedId,
  onSelect,
  onManage,
  placeholderLabel,
  emptyLabel,
  manageLabel,
}: PipelineSelectorProps) {
  const selected = pipelines.find((p) => p.id === selectedId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted">
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="font-semibold">{selected?.name ?? placeholderLabel}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 border-border bg-popover text-popover-foreground"
      >
        {pipelines.length === 0 && (
          <DropdownMenuItem disabled className="text-muted-foreground">
            {emptyLabel}
          </DropdownMenuItem>
        )}
        {pipelines.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={p.id === selectedId ? "text-primary" : "text-popover-foreground"}
          >
            <GitBranch className="mr-2 h-3.5 w-3.5" />
            {p.name}
          </DropdownMenuItem>
        ))}
        {onManage && selected && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem onClick={onManage} className="text-popover-foreground">
              <Settings className="mr-2 h-3.5 w-3.5" />
              {manageLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
