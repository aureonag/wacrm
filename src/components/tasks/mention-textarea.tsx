"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { activeMention, insertMention, type MentionMember } from "@/lib/tasks/mentions";

// A text box where typing "@" opens a short list of people: keep typing to
// narrow it down, or pick one (mouse, arrows + Enter/Tab). The pick is written
// into the text as "@Name"; who was mentioned is worked out from the final
// text when the comment is sent.

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

function initials(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export function MentionTextarea({ value, onChange, members, placeholder, autoFocus, className }: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const mention = dismissed ? null : activeMention(value, caret, members);
  const selected = mention ? Math.min(index, mention.matches.length - 1) : 0;

  // Arrow keys move through a list that scrolls: keep the highlighted person in view.
  useEffect(() => {
    if (!mention) return;
    document.getElementById(`mention-option-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [mention, selected]);

  function choose(i: number) {
    if (!mention) return;
    const member = mention.matches[i];
    if (!member) return;
    const next = insertMention(value, caret, mention, member);
    onChange(next.text);
    setCaret(next.caret);
    setIndex(0);
    // The textarea only knows the new text after this render.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        autoFocus={autoFocus}
        spellCheck
        lang="pt-BR"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setIndex(0);
          setDismissed(false);
        }}
        onKeyUp={(e) => {
          // Arrow keys / Home / End move the caret without changing the text.
          if (!mention || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) {
            setCaret(e.currentTarget.selectionStart ?? 0);
          }
        }}
        onClick={(e) => {
          setCaret(e.currentTarget.selectionStart ?? 0);
          setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (!mention) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((selected + 1) % mention.matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((selected - 1 + mention.matches.length) % mention.matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(selected);
          } else if (e.key === "Escape") {
            // Closes the list only, not the task behind it.
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setDismissed(true);
          }
        }}
        className={className}
      />

      {mention && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-72 max-w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {mention.matches.map((m, i) => (
            <li key={m.id} id={`mention-option-${i}`} role="option" aria-selected={i === selected}>
              <button
                type="button"
                // Keep the focus (and the caret) in the text box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setIndex(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  i === selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"
                }`}
              >
                <Avatar size="sm">
                  {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt={m.name} /> : null}
                  <AvatarFallback>{initials(m.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
