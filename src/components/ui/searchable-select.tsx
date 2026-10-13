"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A select with a search box on top, for long lists (clients, projects…): type a
// few letters and the list narrows, no scrolling through everything. Accents and
// upper/lower case do not matter ("agricon" finds "Agricón").

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** Text of the closed field when `value` matches no option. */
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  disabled?: boolean;
  className?: string;
  /** Always shown first, never filtered out (e.g. "Sem cliente"). */
  noneOption?: SearchableOption;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled,
  className,
  noneOption,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter((o) => fold(o.label).includes(q)) : options;
  }, [options, query]);

  // The "none" row first, then the matches: this is what arrow keys walk through.
  const rows = useMemo(() => (noneOption ? [noneOption, ...filtered] : filtered), [noneOption, filtered]);

  const current = options.find((o) => o.value === value) ?? (noneOption && noneOption.value === value ? noneOption : null);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(0);
    }
  }

  function move(delta: number) {
    const next = Math.min(Math.max(active + delta, 0), Math.max(rows.length - 1, 0));
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted px-2.5 text-left text-xs text-foreground outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--anchor-width) min-w-56 gap-1.5 p-1.5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const row = rows[active];
                if (row) pick(row.value);
              }
            }}
            placeholder={searchPlaceholder}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-60 overflow-y-auto">
          {rows.map((row, index) => {
            const selected = row.value === value;
            return (
              <button
                key={row.value}
                type="button"
                data-index={index}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground",
                  index === active && "bg-accent",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyLabel}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
