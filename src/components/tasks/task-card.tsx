"use client";

import type { BoardStage, Task } from "@/types";
import { Building2, Calendar, Check, Flag, Pause, Play, User } from "lucide-react";
import { formatTaskCode } from "@/lib/tasks/code";
import { LabelPill } from "./task-labels";
import { MemberAvatar } from "./members-field";
import { TaskCardMenu, type TaskMenuAction, type TaskMenuPerms } from "./task-card-menu";
import { formatClockSeconds, summarizeTaskTime } from "@/lib/tasks/timesheet";
import { useTranslations } from "next-intl";

interface TaskCardProps {
  task: Task;
  stage: BoardStage | null;
  isOverlay?: boolean;
  onOpen?: (taskId: string) => void;
  /** Current time (ms), ticked once a second by the board while a timer runs. */
  now: number;
  /** Id of the signed-in user: only their own running timer shows "pause". */
  currentUserId?: string;
  /** Who may start/pause time (permission operational:timesheet:track). */
  canTrack?: boolean;
  onToggleTimer?: (taskId: string, runningByMe: boolean) => void;
  /** A timer request for this card is in flight. */
  timerBusy?: boolean;
  /** Selection (square on the card). Absent = no selection on this board. */
  selection?: {
    selected: boolean;
    /** at least one task of the board is selected: a click on the card toggles it */
    active: boolean;
    onToggle: () => void;
  };
  /** The "•••" menu. Absent = no menu (e.g. the drag preview). */
  menu?: { perms: TaskMenuPerms; onAction: (action: TaskMenuAction) => void };
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function initials(name?: string | null) {
  const source = (name || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-secondary text-secondary-foreground",
  high: "bg-amber-500/15 text-amber-500",
};

export function TaskCard({
  task,
  stage,
  isOverlay,
  onOpen,
  now,
  currentUserId,
  canTrack,
  onToggleTimer,
  timerBusy,
  selection,
  menu,
}: TaskCardProps) {
  const t = useTranslations("Operational.tasks.card");

  const selecting = !!selection?.active;
  const cardClassName = `group relative block w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
    isOverlay
      ? "shadow-xl"
      : selecting
        ? ""
        : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
  } ${selection?.selected ? "border-primary ring-2 ring-primary/40" : ""}`;
  // While something is selected, a click on the card selects it (it does not open it).
  const handleCardClick = () => {
    if (selection && selecting) selection.onToggle();
    else onOpen?.(task.id);
  };
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const time = summarizeTaskTime(task.time_entries, now);
  const runningByMe = !!currentUserId && time.people.some((p) => p.userId === currentUserId && p.running);
  const myTime = time.people.find((p) => p.userId === currentUserId)?.seconds ?? 0;
  const timerLabel = runningByMe ? t("timerPause") : myTime > 0 ? t("timerResume") : t("timerStart");
  const showTime = canTrack || time.totalSeconds > 0 || time.running;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className={cardClassName}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="mb-0.5 flex min-h-6 items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-medium text-muted-foreground">
          {formatTaskCode(task.task_number) ?? ""}
        </p>
        {!isOverlay && (selection || menu) && (
          <div className="-mr-1 flex shrink-0 items-center gap-1">
            {selection && (
              <button
                type="button"
                role="checkbox"
                aria-checked={selection.selected}
                aria-label={t("selectAria")}
                title={t("selectAria")}
                onClick={(e) => {
                  stop(e);
                  selection.onToggle();
                }}
                onPointerDown={stop}
                onKeyDown={stop}
                className={`flex h-4 w-4 items-center justify-center rounded border transition-opacity ${
                  selection.selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/50 bg-transparent opacity-60 hover:opacity-100 group-hover:opacity-100"
                }`}
              >
                {selection.selected && <Check className="h-3 w-3" />}
              </button>
            )}
            {menu && <TaskCardMenu perms={menu.perms} onAction={menu.onAction} />}
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {task.title}
        </h4>
        <Flag
          className={`h-3.5 w-3.5 shrink-0 ${task.is_urgent ? "fill-red-500 text-red-500" : "text-muted-foreground/40"}`}
        />
      </div>

      {task.project?.client_name ? (
        <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={`${task.project.client_name} — ${task.project.name}`}>
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {task.project.client_name}
            <span className="text-muted-foreground/70"> · {task.project.name}</span>
          </span>
        </p>
      ) : (
        task.contact && (
          <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{task.contact.name || task.contact.phone}</span>
          </p>
        )
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${PRIORITY_STYLES[task.priority]}`}>
          {t(`priority.${task.priority}`)}
        </span>
        {(task.tags ?? []).map((tag) => (
          <LabelPill key={tag.id} name={tag.label} color={tag.color} />
        ))}
      </div>

      {showTime && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            {canTrack && !isOverlay && (
              <button
                type="button"
                disabled={timerBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTimer?.(task.id, runningByMe);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={timerLabel}
                title={timerLabel}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                  runningByMe
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-primary/15 text-primary hover:bg-primary/25"
                }`}
              >
                {runningByMe ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
              </button>
            )}
            <span
              title={t("timeTotal")}
              className={`font-mono text-xs tabular-nums ${time.running ? "font-semibold text-primary" : "text-muted-foreground"}`}
            >
              {formatClockSeconds(time.totalSeconds)}
            </span>
          </div>

          {time.people.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {time.people.map((p) => (
                <li
                  key={p.userId}
                  title={p.name}
                  className="flex items-center gap-1 text-[10.5px] text-muted-foreground"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold ${
                      p.running ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"
                    }`}
                  >
                    {initials(p.name)}
                  </span>
                  <span className={`font-mono tabular-nums ${p.running ? "text-primary" : ""}`}>
                    {formatClockSeconds(p.seconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        {task.due_date ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(task.due_date)}
          </span>
        ) : (
          <span />
        )}
        {(task.members?.length ?? 0) > 0 ? (
          <span className="flex items-center -space-x-1.5">
            {task.members!.slice(0, 3).map((m) => (
              <span key={m.id} className="rounded-full ring-2 ring-muted">
                <MemberAvatar member={m} size={20} />
              </span>
            ))}
            {task.members!.length > 3 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-semibold text-muted-foreground ring-2 ring-muted">
                +{task.members!.length - 3}
              </span>
            )}
          </span>
        ) : (
          task.assignee?.full_name && (
            <span
              title={task.assignee.full_name}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(task.assignee.full_name)}
            </span>
          )
        )}
      </div>
    </div>
  );
}
