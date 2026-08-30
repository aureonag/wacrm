"use client";

import { useTranslations } from "next-intl";
import type { Deal } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UserFilterProps {
  deals: Deal[];
  selectedUserId: string | null;
  onChange: (userId: string | null) => void;
}

// "All" plus one entry per user who has actually created a deal in this
// pipeline — never the whole account roster, so the list can't show
// someone with zero deals here (per the spec: "só aparece o usuário que
// tem deal criado dentro do funil").
export function UserFilter({ deals, selectedUserId, onChange }: UserFilterProps) {
  const t = useTranslations("Dashboard.userFilter");

  const creators = new Map<string, string>();
  for (const d of deals) {
    if (!creators.has(d.user_id)) {
      creators.set(d.user_id, d.creator?.full_name || d.creator?.email || d.user_id);
    }
  }
  const options = [...creators.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const currentLabel = selectedUserId ? (creators.get(selectedUserId) ?? t("all")) : t("all");

  return (
    <Select
      value={selectedUserId ?? "all"}
      onValueChange={(v) => onChange(v === "all" ? null : v)}
    >
      <SelectTrigger className="w-48 border-border bg-card text-foreground">
        <SelectValue>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent className="border-border bg-popover text-popover-foreground">
        <SelectItem value="all">{t("all")}</SelectItem>
        {options.map(([userId, name]) => (
          <SelectItem key={userId} value={userId}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
