"use client";

import Link from "next/link";
import { Timer, Square } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useActiveTimer } from "@/hooks/use-active-timer";
import { useClockTick } from "@/hooks/use-clock-tick";
import { formatElapsedClock } from "@/lib/tasks/timesheet";

/** Persistent "a timer is running" badge — mounted once in Header so it
 *  survives navigation between Comercial/Operacional and between pages,
 *  per Etapa 2 item 13 ("cronômetro persistente, não por página"). Reads
 *  the same live row useActiveTimer subscribes to; empty render when
 *  nothing is running. */
export function ActiveTimerIndicator() {
  const t = useTranslations("Header.activeTimer");
  const { activeTimer, refresh } = useActiveTimer();
  const now = useClockTick(!!activeTimer);

  if (!activeTimer) return null;

  const taskTitle = activeTimer.task?.title ?? t("untitledTask");
  const boardId = activeTimer.task?.board_id;
  const taskId = activeTimer.task_id;

  async function handleStop() {
    const res = await fetch("/api/operational/timesheet/stop", { method: "POST" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    refresh();
  }

  const content = (
    <>
      <Timer className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
      <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{taskTitle}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {formatElapsedClock(activeTimer.started_at, now)}
      </span>
    </>
  );

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pl-2.5 pr-1 text-xs font-medium text-foreground">
      {boardId ? (
        <Link
          href={`/operational/boards/${boardId}?task=${taskId}`}
          className="flex items-center gap-1.5 hover:opacity-80"
          title={t("goToTask")}
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-1.5">{content}</div>
      )}
      <button
        type="button"
        onClick={handleStop}
        aria-label={t("stop")}
        title={t("stop")}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <Square className="h-2.5 w-2.5 fill-current" />
      </button>
    </div>
  );
}
