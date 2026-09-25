"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface PickedContact {
  id: string;
  name: string;
}

interface ContactPickerProps {
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  disabled?: boolean;
  /** Extra classes for the trigger, so it can match the surrounding inputs. */
  triggerClassName?: string;
}

/** Client field for a task: searches the CRM's contacts as the person types. */
export function ContactPicker({ value, onChange, disabled, triggerClassName }: ContactPickerProps) {
  const t = useTranslations("Operational.taskDrawer");
  const supabase = createClient();
  const { accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedContact[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setSearching(true);
      let q = supabase.from("contacts").select("id, name").eq("account_id", accountId).order("name").limit(8);
      const term = query.trim().replace(/[%,()]/g, " ");
      if (term) q = q.ilike("name", `%${term}%`);
      const { data } = await q;
      if (cancelled) return;
      setResults((data ?? []) as PickedContact[]);
      setSearching(false);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, accountId, supabase]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
      <div className="flex items-center gap-1">
        <PopoverTrigger
          disabled={disabled}
          className={
            triggerClassName ??
            "flex h-8 min-w-0 flex-1 items-center rounded-md border border-border bg-muted px-2 text-left text-xs text-foreground disabled:opacity-50"
          }
        >
          <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>{value?.name ?? t("clientNone")}</span>
        </PopoverTrigger>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("clientClear")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-72">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("clientSearch")}
            className="h-8 flex-1 bg-transparent text-xs text-foreground outline-none"
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {searching ? "…" : t("clientEmpty")}
            </p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
