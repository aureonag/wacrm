"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Users } from "lucide-react";

export const OWNER_FILTER_ALL = "all";
export const OWNER_FILTER_MINE = "mine";

export interface OwnerFilterMember {
  id: string;
  name: string;
}

interface PipelineOwnerFilterProps {
  value: string;
  onChange: (value: string) => void;
  /** Only passed for the account owner — other roles just get All / Mine. */
  members?: OwnerFilterMember[];
  allLabel: string;
  mineLabel: string;
  membersLabel: string;
}

export function PipelineOwnerFilter({
  value,
  onChange,
  members,
  allLabel,
  mineLabel,
  membersLabel,
}: PipelineOwnerFilterProps) {
  const label =
    value === OWNER_FILTER_ALL
      ? allLabel
      : value === OWNER_FILTER_MINE
        ? mineLabel
        : (members?.find((m) => m.id === value)?.name ?? allLabel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted">
        <Users className="h-4 w-4 text-primary" />
        <span className="font-semibold">{label}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56 border-border bg-popover text-popover-foreground"
      >
        <DropdownMenuItem
          onClick={() => onChange(OWNER_FILTER_ALL)}
          className={value === OWNER_FILTER_ALL ? "text-primary" : ""}
        >
          {allLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange(OWNER_FILTER_MINE)}
          className={value === OWNER_FILTER_MINE ? "text-primary" : ""}
        >
          {mineLabel}
        </DropdownMenuItem>
        {members && members.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{membersLabel}</DropdownMenuLabel>
              {members.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onChange(m.id)}
                  className={value === m.id ? "text-primary" : ""}
                >
                  {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
