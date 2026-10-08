"use client";

import { useEffect, useState } from "react";
import { Smile } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EMOJI_CATEGORIES } from "@/lib/emoji-data";

// The emoji library: a button that opens a small panel with ready-made emojis
// by category (and the ones used last). Used in every writing box.

const RECENT_KEY = "wacrm:emoji-recent";
const RECENT_MAX = 16;

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberRecent(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the panel just does not remember.
  }
}

interface EmojiPopoverProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
  /** Where the panel opens relative to the button. */
  side?: "top" | "bottom";
}

export function EmojiPopover({ onPick, disabled, className, side = "top" }: EmojiPopoverProps) {
  const t = useTranslations("Emoji");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].key);
  const [recent, setRecent] = useState<string[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const current = EMOJI_CATEGORIES.find((c) => c.key === category) ?? EMOJI_CATEGORIES[0];

  function pick(emoji: string) {
    rememberRecent(emoji);
    onPick(emoji);
    // Stays open on purpose: people often add several in a row. Esc or a click outside closes.
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={t("label")}
        title={t("label")}
        // Keep the caret in the writing box when the button is clicked.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:bg-muted data-popup-open:text-foreground",
          className,
        )}
      >
        <Smile className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent side={side} align="end" sideOffset={6} className="w-72 gap-2 p-2">
        <div className="flex items-center gap-0.5 border-b border-border pb-1.5">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              title={t(`categories.${c.key}`)}
              aria-label={t(`categories.${c.key}`)}
              className={cn(
                "flex h-7 flex-1 items-center justify-center rounded-md text-base transition-colors hover:bg-muted",
                category === c.key && "bg-muted",
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("recent")}</p>
            <div className="flex flex-wrap gap-0.5">
              {recent.map((e) => (
                <EmojiCell key={e} emoji={e} onPick={pick} />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`categories.${current.key}`)}
          </p>
          <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto pr-1">
            {current.emojis.map((e) => (
              <EmojiCell key={e} emoji={e} onPick={pick} />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiCell({ emoji, onPick }: { emoji: string; onPick: (emoji: string) => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(emoji)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-xl leading-none transition-transform hover:scale-125 hover:bg-muted"
    >
      {emoji}
    </button>
  );
}

/**
 * Inserts text where the caret is in a textarea, and tells React about it (the
 * native setter + an "input" event make controlled and uncontrolled textareas
 * both see the change, so no caller needs its own handler for emojis).
 */
export function insertIntoTextarea(el: HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, next);
  const pos = start + text.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The emoji button wired to a textarea (through its ref). */
export function EmojiButton({
  targetRef,
  className,
  disabled,
  side,
}: {
  targetRef: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
  disabled?: boolean;
  side?: "top" | "bottom";
}) {
  return (
    <EmojiPopover
      className={className}
      disabled={disabled}
      side={side}
      onPick={(emoji) => {
        if (targetRef.current) insertIntoTextarea(targetRef.current, emoji);
      }}
    />
  );
}
