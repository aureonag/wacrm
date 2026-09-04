"use client";

import { useMemo, useState } from "react";
import type { TimesheetEntry } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Square, Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useActiveTimer } from "@/hooks/use-active-timer";
import { useClockTick } from "@/hooks/use-clock-tick";
import { formatElapsedClock, formatMinutes, minutesBetween } from "@/lib/tasks/timesheet";

interface TimesheetPanelProps {
  taskId: string;
  entries: TimesheetEntry[];
  estimatedMinutes: number | null;
  currentUserId?: string;
  canTrack: boolean;
  canLogManual: boolean;
  canEditEntries: boolean;
  onChanged: () => void;
}

export function TimesheetPanel({
  taskId,
  entries,
  estimatedMinutes,
  currentUserId,
  canTrack,
  canLogManual,
  canEditEntries,
  onChanged,
}: TimesheetPanelProps) {
  const t = useTranslations("Operational.timesheet");
  const { activeTimer, refresh } = useActiveTimer();
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const runningHere = activeTimer?.task_id === taskId ? activeTimer : null;
  const runningElsewhere = activeTimer && activeTimer.task_id !== taskId ? activeTimer : null;
  const now = useClockTick(!!runningHere);

  const closedMinutes = useMemo(
    () => entries.filter((e) => e.ended_at).reduce((sum, e) => sum + minutesBetween(e.started_at, e.ended_at!), 0),
    [entries],
  );
  const liveMinutes = runningHere ? Math.round((now - new Date(runningHere.started_at).getTime()) / 60_000) : 0;
  const totalMinutes = closedMinutes + liveMinutes;

  const byPerson = useMemo(() => {
    const map = new Map<string, { name: string; minutes: number }>();
    for (const e of entries) {
      if (!e.ended_at) continue;
      const key = e.user_id ?? "unknown";
      const name = e.author?.full_name ?? t("unknownPerson");
      const minutes = minutesBetween(e.started_at, e.ended_at);
      const existing = map.get(key);
      map.set(key, { name, minutes: (existing?.minutes ?? 0) + minutes });
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [entries, t]);

  async function handleStart() {
    setBusy(true);
    const res = await fetch("/api/operational/timesheet/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    refresh();
    onChanged();
  }

  async function handleStop() {
    setBusy(true);
    const res = await fetch("/api/operational/timesheet/stop", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    refresh();
    onChanged();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/operational/timesheet/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        {runningHere ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-lg tabular-nums text-foreground">
                {formatElapsedClock(runningHere.started_at, now)}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={handleStop} disabled={busy}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t("stop")}
            </Button>
          </div>
        ) : runningElsewhere ? (
          <p className="text-xs text-muted-foreground">
            {t("runningElsewhere", { title: runningElsewhere.task?.title ?? t("untitledTask") })}{" "}
            {runningElsewhere.task?.board_id && (
              <a
                href={`/operational/boards/${runningElsewhere.task.board_id}?task=${runningElsewhere.task_id}`}
                className="text-primary underline"
              >
                {t("goThere")}
              </a>
            )}
          </p>
        ) : canTrack ? (
          <Button size="sm" onClick={handleStart} disabled={busy}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t("start")}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("empty")}</p>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {t("totalWorked", { time: formatMinutes(totalMinutes) })}
        </span>
        {estimatedMinutes != null && (
          <span className="text-muted-foreground">
            {t("estimated", { time: formatMinutes(estimatedMinutes) })}
          </span>
        )}
      </div>

      {byPerson.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-2.5">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("byPerson")}
          </p>
          {byPerson.map((p) => (
            <div key={p.name} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{p.name}</span>
              <span className="text-muted-foreground">{formatMinutes(p.minutes)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {entries.map((entry) =>
          editingId === entry.id ? (
            <ManualEntryForm
              key={entry.id}
              taskId={taskId}
              initial={entry}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                onChanged();
              }}
            />
          ) : (
            <div key={entry.id} className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm text-foreground">
                  <span className="truncate">{entry.author?.full_name ?? t("unknownPerson")}</span>
                  {entry.is_manual && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                      {t("manualBadge")}
                    </span>
                  )}
                  {!entry.ended_at && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9.5px] font-medium text-primary">
                      {t("runningBadge")}
                    </span>
                  )}
                </div>
                {entry.description && (
                  <p className="truncate text-xs text-muted-foreground">{entry.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {entry.ended_at ? formatMinutes(minutesBetween(entry.started_at, entry.ended_at)) : "—"}
              </span>
              {(canEditEntries || (canTrack && entry.user_id === currentUserId)) && entry.ended_at && (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingId(entry.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    className="text-muted-foreground hover:text-red-400"
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ),
        )}
        {entries.length === 0 && <p className="text-sm text-muted-foreground">{t("noEntries")}</p>}
      </div>

      {canLogManual && (
        <div>
          {showManual ? (
            <ManualEntryForm
              taskId={taskId}
              onCancel={() => setShowManual(false)}
              onSaved={() => {
                setShowManual(false);
                onChanged();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("logManual")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared by "lançar manualmente" and the edit-in-place row — same two
 *  datetime fields plus an optional description, differing only in
 *  whether it POSTs a new entry or PATCHes an existing one. */
function ManualEntryForm({
  taskId,
  initial,
  onCancel,
  onSaved,
}: {
  taskId: string;
  initial?: TimesheetEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Operational.timesheet");
  const [startedAt, setStartedAt] = useState(initial ? toLocalInput(initial.started_at) : "");
  const [endedAt, setEndedAt] = useState(initial?.ended_at ? toLocalInput(initial.ended_at) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!startedAt || !endedAt) return;
    setSaving(true);
    const body = {
      task_id: taskId,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      description: description.trim() || null,
    };
    const res = initial
      ? await fetch(`/api/operational/timesheet/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/operational/timesheet/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("startField")}</Label>
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className="h-8 border-border bg-muted text-xs text-foreground"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("endField")}</Label>
          <Input
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
            className="h-8 border-border bg-muted text-xs text-foreground"
          />
        </div>
      </div>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("descriptionPlaceholder")}
        className="h-8 border-border bg-muted text-xs text-foreground"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !startedAt || !endedAt}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

/** ISO timestamp -> `datetime-local` input value (local time, no TZ). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
