"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { memberInitials, type TaskMember } from "@/lib/tasks/members";

// "Membros" of a task, as in Trello: the faces of the people on it and a "+"
// that opens a panel with a search box, the people already on the task (with an
// x to take them off) and the other people who can work on it.

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function MemberAvatar({ member, size = 28 }: { member: TaskMember; size?: number }) {
  const dim = { width: size, height: size };
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt={member.name}
        title={member.name}
        style={dim}
        className="shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <span
      title={member.name}
      style={{ ...dim, fontSize: Math.max(9, Math.round(size * 0.38)) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/20 font-semibold text-primary"
    >
      {memberInitials(member.name)}
    </span>
  );
}

interface MembersFieldProps {
  /** People on the task (first = main person). */
  members: TaskMember[];
  /** Everyone who may be added (people with access to Operacional). */
  candidates: TaskMember[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function MembersField({ members, candidates, onChange, disabled, className }: MembersFieldProps) {
  const t = useTranslations("Operational.members");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const q = fold(query.trim());
  const matches = (m: TaskMember) => !q || fold(m.name).includes(q);

  const onTask = members.filter(matches);
  const others = candidates.filter((c) => !memberIds.has(c.id)).filter(matches);

  function add(id: string) {
    onChange([...members.map((m) => m.id), id]);
  }
  function remove(id: string) {
    onChange(members.filter((m) => m.id !== id).map((m) => m.id));
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {members.map((m) => (
        <MemberAvatar key={m.id} member={m} />
      ))}
      {!disabled && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setQuery("");
          }}
        >
          <PopoverTrigger
            aria-label={t("add")}
            title={t("add")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-72 gap-2 p-3">
            <div className="relative flex items-center justify-center">
              <h4 className="text-sm font-semibold text-foreground">{t("title")}</h4>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="absolute right-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 focus-within:border-primary">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-72 overflow-y-auto">
              {onTask.length > 0 && (
                <section className="mb-2">
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("onTask")}</p>
                  {onTask.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5">
                      <MemberAvatar member={m} size={26} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.name}</span>
                      <button
                        type="button"
                        onClick={() => remove(m.id)}
                        aria-label={t("remove", { name: m.name })}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <section>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("available")}</p>
                {others.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("none")}</p>
                ) : (
                  others.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => add(m.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <MemberAvatar member={m} size={26} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.name}</span>
                    </button>
                  ))
                )}
              </section>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
