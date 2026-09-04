// Pure metric builders for the Dashboard Operacional (Etapa 3, fase 5).
// Same architecture as src/lib/dashboard/queries.ts: no Supabase calls
// here, just typed transforms over arrays the page already loaded
// (RLS scopes the rows; has_permission() scopes what module a user can
// even query). Period math is shared verbatim from
// src/lib/dashboard/period.ts — it was already deal-agnostic.

import type { Board, Task, TaskStageHistory, TimesheetEntry } from "@/types";
import type { DateRange } from "@/lib/dashboard/period";
import { isWithinRange } from "@/lib/dashboard/period";
import { minutesBetween } from "@/lib/tasks/timesheet";

export type DashboardScope = "own" | "sector" | "all";

/** Highest scope the caller's permissions resolve to, or null if none of
 *  the dashboard permissions are granted. `hasLegacyView` is
 *  operational.dashboard.view (058) — pre-dates the 3-level split (067)
 *  and is treated as the "own" level so existing grants keep working. */
export function resolveDashboardScope(
  hasViewAll: boolean,
  hasViewSector: boolean,
  hasViewOwn: boolean,
  hasLegacyView: boolean,
): DashboardScope | null {
  if (hasViewAll) return "all";
  if (hasViewSector) return "sector";
  if (hasViewOwn || hasLegacyView) return "own";
  return null;
}

/** Scopes the account's tasks down to what a given permission level may
 *  see. `mySectorIds` is only consulted for the "sector" level. */
export function scopeTasks(
  tasks: Task[],
  scope: DashboardScope,
  myProfileId: string | undefined,
  mySectorIds: string[],
): Task[] {
  if (scope === "all") return tasks;
  if (scope === "sector") return tasks.filter((t) => t.sector_id && mySectorIds.includes(t.sector_id));
  return tasks.filter((t) => t.assignee_id === myProfileId);
}

/** Timesheet entries are keyed by auth user id, not profile id or
 *  sector — scoping them by "does this entry's task fall in my scoped
 *  task set" avoids a second sector-membership join for timesheet rows. */
export function scopeTimesheetByTasks(entries: TimesheetEntry[], scopedTaskIds: Set<string>): TimesheetEntry[] {
  return entries.filter((e) => scopedTaskIds.has(e.task_id));
}

// ---- Volume -----------------------------------------------------------

export interface VolumeMetrics {
  totalOpen: number;
  createdInPeriod: number;
  completedInPeriod: number;
  byBoard: { boardId: string; boardName: string; count: number }[];
}

export function buildVolumeMetrics(tasks: Task[], boards: Board[], range: DateRange): VolumeMetrics {
  const totalOpen = tasks.filter((t) => t.status === "open").length;
  const createdInPeriod = tasks.filter((t) => isWithinRange(t.created_at, range)).length;
  const completedInPeriod = tasks.filter((t) => t.completed_at && isWithinRange(t.completed_at, range)).length;

  const countByBoard = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== "open") continue;
    countByBoard.set(t.board_id, (countByBoard.get(t.board_id) ?? 0) + 1);
  }
  const boardNameById = new Map(boards.map((b) => [b.id, b.name]));
  const byBoard = [...countByBoard.entries()]
    .map(([boardId, count]) => ({ boardId, boardName: boardNameById.get(boardId) ?? "—", count }))
    .sort((a, b) => b.count - a.count);

  return { totalOpen, createdInPeriod, completedInPeriod, byBoard };
}

// ---- Tempo --------------------------------------------------------------

export interface TimeMetrics {
  avgCompletionMinutes: number | null;
  totalMinutesLogged: number;
}

export function buildTimeMetrics(tasks: Task[], timesheet: TimesheetEntry[], range: DateRange): TimeMetrics {
  const completed = tasks.filter((t) => t.completed_at && isWithinRange(t.completed_at, range));
  const durations = completed.map((t) => minutesBetween(t.created_at, t.completed_at!));
  const avgCompletionMinutes =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const totalMinutesLogged = timesheet
    .filter((e) => e.ended_at && isWithinRange(e.started_at, range))
    .reduce((sum, e) => sum + minutesBetween(e.started_at, e.ended_at!), 0);

  return { avgCompletionMinutes, totalMinutesLogged };
}

// ---- Prazos ---------------------------------------------------------------

export interface DeadlineMetrics {
  overdueCount: number;
  dueSoonCount: number;
  onTimeRate: number | null;
}

const DUE_SOON_DAYS = 3;

export function buildDeadlineMetrics(tasks: Task[], range: DateRange, now: Date = new Date()): DeadlineMetrics {
  const todayIso = now.toISOString().slice(0, 10);
  const soonIso = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);

  const openTasks = tasks.filter((t) => t.status === "open" && t.due_date);
  const overdueCount = openTasks.filter((t) => t.due_date! < todayIso).length;
  const dueSoonCount = openTasks.filter((t) => t.due_date! >= todayIso && t.due_date! <= soonIso).length;

  const completedWithDueDate = tasks.filter(
    (t) => t.completed_at && t.due_date && isWithinRange(t.completed_at, range),
  );
  const onTime = completedWithDueDate.filter((t) => t.completed_at!.slice(0, 10) <= t.due_date!).length;
  const onTimeRate =
    completedWithDueDate.length > 0 ? Math.round((onTime / completedWithDueDate.length) * 100) : null;

  return { overdueCount, dueSoonCount, onTimeRate };
}

// ---- Atenção operacional ----------------------------------------------

export interface AttentionCounts {
  overdue: number;
  urgent: number;
  unassigned: number;
  stuck: number;
}

const STUCK_AFTER_DAYS = 7;

export function buildAttentionCounts(
  tasks: Task[],
  stageHistory: TaskStageHistory[],
  now: Date = new Date(),
): AttentionCounts {
  const todayIso = now.toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status === "open");

  const lastMovedAt = new Map<string, string>();
  for (const h of stageHistory) {
    const prev = lastMovedAt.get(h.task_id);
    if (!prev || h.changed_at > prev) lastMovedAt.set(h.task_id, h.changed_at);
  }
  const stuckCutoff = now.getTime() - STUCK_AFTER_DAYS * 86_400_000;
  const stuck = open.filter((t) => {
    const lastTouch = lastMovedAt.get(t.id) ?? t.created_at;
    return new Date(lastTouch).getTime() < stuckCutoff;
  }).length;

  return {
    overdue: open.filter((t) => t.due_date && t.due_date < todayIso).length,
    urgent: open.filter((t) => t.is_urgent).length,
    unassigned: open.filter((t) => !t.assignee_id).length,
    stuck,
  };
}

// ---- Equipe -----------------------------------------------------------

export interface TeamRow {
  profileId: string;
  name: string;
  assignedOpen: number;
  completedInPeriod: number;
  minutesLoggedInPeriod: number;
}

export function buildTeamRows(
  tasks: Task[],
  timesheet: TimesheetEntry[],
  range: DateRange,
): TeamRow[] {
  const rows = new Map<string, TeamRow>();

  function rowFor(profileId: string, name: string): TeamRow {
    let row = rows.get(profileId);
    if (!row) {
      row = { profileId, name, assignedOpen: 0, completedInPeriod: 0, minutesLoggedInPeriod: 0 };
      rows.set(profileId, row);
    }
    return row;
  }

  for (const t of tasks) {
    if (!t.assignee_id) continue;
    const name = t.assignee?.full_name ?? "—";
    const row = rowFor(t.assignee_id, name);
    if (t.status === "open") row.assignedOpen += 1;
    if (t.completed_at && isWithinRange(t.completed_at, range)) row.completedInPeriod += 1;
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const e of timesheet) {
    if (!e.ended_at || !isWithinRange(e.started_at, range)) continue;
    const task = taskById.get(e.task_id);
    if (!task?.assignee_id) continue;
    const row = rowFor(task.assignee_id, task.assignee?.full_name ?? "—");
    row.minutesLoggedInPeriod += minutesBetween(e.started_at, e.ended_at);
  }

  return [...rows.values()].sort((a, b) => b.assignedOpen - a.assignedOpen);
}
