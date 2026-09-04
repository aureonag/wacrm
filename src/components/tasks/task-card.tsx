"use client";

import type { BoardStage, Task } from "@/types";
import { Calendar, Flag } from "lucide-react";
import { useTranslations } from "next-intl";

interface TaskCardProps {
  task: Task;
  stage: BoardStage | null;
  isOverlay?: boolean;
  onOpen?: (taskId: string) => void;
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

export function TaskCard({ task, stage, isOverlay, onOpen }: TaskCardProps) {
  const t = useTranslations("Operational.tasks.card");

  const cardClassName = `group relative block w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
    isOverlay
      ? "shadow-xl"
      : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
  }`;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      className={cardClassName}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {task.title}
        </h4>
        <Flag
          className={`h-3.5 w-3.5 shrink-0 ${task.is_urgent ? "fill-red-500 text-red-500" : "text-muted-foreground/40"}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${PRIORITY_STYLES[task.priority]}`}>
          {t(`priority.${task.priority}`)}
        </span>
        {(task.tags ?? []).map((tag) => (
          <span
            key={tag.id}
            className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{
              backgroundColor: `${tag.color}20`,
              color: tag.color,
              border: `1px solid ${tag.color}40`,
            }}
          >
            {tag.label}
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {task.due_date ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(task.due_date)}
          </span>
        ) : (
          <span />
        )}
        {task.assignee?.full_name && (
          <span
            title={task.assignee.full_name}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(task.assignee.full_name)}
          </span>
        )}
      </div>
    </button>
  );
}
