"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { searchDeals } from "@/lib/pipelines/queries";
import type { DealSearchResult } from "@/types";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Strips diacritics so "sao jose" highlights/matches "São José" — a
// precomposed accented char (1 UTF-16 unit) decomposes to base + one
// combining mark; removing the mark leaves the same length as the
// original, so index positions found here still line up with `text`.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const idx = foldAccents(text).indexOf(foldAccents(term));
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-semibold text-primary">{text.slice(idx, idx + term.length)}</strong>
      {text.slice(idx + term.length)}
    </>
  );
}

/** Cross-pipeline deal search for the Pipelines page — Ctrl+K/Cmd+K
 *  from anywhere on the page, or clicking the trigger, opens a
 *  floating live-search box (see `search_deals`, migration 055).
 *  Scoped to deals for now; the RPC/result shape is generic enough
 *  to extend to contacts/companies/tasks later without a rewrite. */
export function PipelineSearch() {
  const t = useTranslations("Pipelines.search");
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setTotalCount(0);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mySeq = ++requestSeq.current;
    const timeout = setTimeout(async () => {
      const rows = await searchDeals(supabase, term, 10);
      if (mySeq !== requestSeq.current) return; // superseded by a newer keystroke
      setResults(rows);
      setTotalCount(rows[0]?.total_count ?? 0);
      setActiveIndex(0);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function openResult(result: DealSearchResult) {
    setOpen(false);
    router.push(`/pipelines/deals/${result.deal_id}`);
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex];
      if (target) openResult(target);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const term = query.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("triggerLabel")}
        title={t("triggerLabel")}
      >
        <Search className="h-4 w-4" />
        <kbd className="hidden rounded border border-border/60 bg-muted px-1 text-[10px] font-medium text-muted-foreground sm:inline">
          Ctrl K
        </kbd>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-96 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t("placeholder")}
              className="border-0 bg-transparent pl-7 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto p-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : term === "" ? (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{t("hint")}</p>
          ) : results.length === 0 ? (
            <div className="space-y-1 px-2.5 py-6 text-center">
              <p className="text-sm text-foreground">{t("emptyTitle", { term })}</p>
              <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {results.map((r, i) => (
                <li key={r.deal_id}>
                  <button
                    type="button"
                    onClick={() => openResult(r)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "w-full rounded-md px-2.5 py-2 text-left transition-colors",
                      i === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <p className="truncate text-sm font-medium text-foreground">{highlight(r.title, term)}</p>
                    {(r.contact_name || r.contact_company) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {highlight([r.contact_name, r.contact_company].filter(Boolean).join(" · "), term)}
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <span>{r.pipeline_name}</span>
                      <span aria-hidden>›</span>
                      <span>{r.stage_name}</span>
                      {r.assignee_name && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{t("assignee", { name: r.assignee_name })}</span>
                        </>
                      )}
                    </p>
                    {r.matched_snippet && (
                      <p className="mt-1 truncate text-xs text-muted-foreground/80 italic">
                        {highlight(r.matched_snippet, term)}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {totalCount > results.length && (
          <div className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
            {t("viewAll", { count: totalCount })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
