"use client";

// Marketing timeline of one client: dated milestones that explain the numbers.
// The ones inside a report's period are printed in it when it is generated.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useHasPermission } from "@/hooks/use-permissions";
import { showDate } from "@/lib/reportei/format";
import { resolvePeriod } from "@/lib/reportei/periods";
import { DESCRIPTION_MAX, TITLE_MAX, parseTimelineInput, type TimelineEvent } from "@/lib/reportei/timeline";

export function TimelinePanel({ clientId }: { clientId: string }) {
  const t = useTranslations("Operational.reportei.timelinePanel");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = resolvePeriod("last_7d").until;
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/timeline`);
      if (!res.ok) throw new Error("load");
      setEvents(((await res.json()) as { events: TimelineEvent[] }).events);
      setFailed(false);
    } catch {
      setFailed(true);
      setEvents((prev) => prev ?? []);
    }
  }, [clientId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    void load();
  }, [load]);

  const input = { date, title, description };
  const valid = parseTimelineInput(input) !== null;

  async function add() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return toast.error(t("saveError"));
      setTitle("");
      setDescription("");
      toast.success(t("saved"));
      void load();
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(event: TimelineEvent) {
    if (!window.confirm(t("deleteConfirm", { title: event.title }))) return;
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/timeline/${event.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error(t("deleteError"));
    setEvents((prev) => prev?.filter((e) => e.id !== event.id) ?? prev);
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {canEdit && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("dateLabel")}</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("titleLabel")}</span>
              <Input value={title} maxLength={TITLE_MAX} placeholder={t("titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">{t("descriptionLabel")}</span>
            <Textarea value={description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="flex justify-end">
            <Button size="sm" disabled={saving || !valid} onClick={add}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {t("add")}
            </Button>
          </div>
        </section>
      )}

      {events === null && <Skeleton className="h-32" />}
      {failed && <p className="text-sm text-red-500">{t("error")}</p>}
      {events !== null && events.length === 0 && !failed && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {events !== null && events.length > 0 && (
        <ol className="space-y-0 border-l border-border pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative pb-5 last:pb-0">
              <span className="absolute -left-[1.6rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CalendarDays className="h-2.5 w-2.5" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{showDate(e.date)}</p>
                  <p className="text-sm font-medium text-foreground">{e.title}</p>
                  {e.description && <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{e.description}</p>}
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon" aria-label={t("delete")} title={t("delete")} onClick={() => remove(e)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
