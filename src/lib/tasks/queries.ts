import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Board,
  BoardStage,
  Profile,
  Task,
  TaskActivity,
  TaskApproval,
  TaskChecklistItem,
  TaskComment,
  TaskRecurrenceRule,
  TaskStageHistory,
  TaskTag,
  TimesheetEntry,
} from "@/types";

// Shared reads for the Gestão de Tarefas module — same role as
// src/lib/pipelines/queries.ts for Comercial. Reads go straight to
// Supabase (RLS already scopes via is_account_member + has_permission);
// writes go through src/app/api/operational/** instead of direct client
// calls, unlike the Comercial precedent — see 060_task_management_core.sql's
// header comment for why.

export async function loadBoards(db: SupabaseClient): Promise<Board[]> {
  const { data, error } = await db.from("boards").select("*").order("created_at");
  if (error) {
    console.error("Failed to load boards:", error.message);
    return [];
  }
  return (data ?? []) as Board[];
}

export async function loadBoardStages(db: SupabaseClient, boardId: string): Promise<BoardStage[]> {
  const { data, error } = await db
    .from("board_stages")
    .select("*")
    .eq("board_id", boardId)
    .order("position");
  if (error) {
    console.error("Failed to load board stages:", error.message);
    return [];
  }
  return (data ?? []) as BoardStage[];
}

export async function loadBoardTasks(db: SupabaseClient, boardId: string): Promise<Task[]> {
  const { data, error } = await db
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(*), contact:contacts(*)")
    .eq("board_id", boardId)
    .is("parent_task_id", null)
    .order("position");
  if (error) {
    console.error("Failed to load board tasks:", error.message);
    return [];
  }
  return hydrateTaskProject(db, await hydrateTaskTime(db, await hydrateTaskTags(db, (data ?? []) as Task[])));
}

/** Batch-attaches `project` (name + client) with two plain queries (no embed that could break the board). */
async function hydrateTaskProject(db: SupabaseClient, tasks: Task[]): Promise<Task[]> {
  const projectIds = [...new Set(tasks.map((t) => t.project_id).filter((v): v is string => !!v))];
  if (projectIds.length === 0) return tasks;

  const { data: projects, error } = await db.from("ops_projects").select("id, name, client_id").in("id", projectIds);
  if (error) {
    console.error("Failed to load task projects:", error.message);
    return tasks;
  }
  const rows = (projects ?? []) as { id: string; name: string; client_id: string }[];
  const clientIds = [...new Set(rows.map((p) => p.client_id))];
  const clientById = new Map<string, { name: string; code: string | null }>();
  if (clientIds.length > 0) {
    const { data: clients } = await db.from("ops_clients").select("id, name, code").in("id", clientIds);
    for (const c of (clients ?? []) as { id: string; name: string; code: string | null }[]) {
      clientById.set(c.id, { name: c.name, code: c.code });
    }
  }
  const projectById = new Map(
    rows.map((p) => [
      p.id,
      { id: p.id, name: p.name, client_name: clientById.get(p.client_id)?.name ?? null, client_code: clientById.get(p.client_id)?.code ?? null },
    ]),
  );
  return tasks.map((t) => (t.project_id ? { ...t, project: projectById.get(t.project_id) ?? null } : t));
}

/** Batch-attaches `time_entries` (who tracked what, with names) in two extra
 *  queries, so the Kanban card can show the total and each person's time. */
async function hydrateTaskTime(db: SupabaseClient, tasks: Task[]): Promise<Task[]> {
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) return tasks;

  const { data: rows, error } = await db
    .from("timesheet_entries")
    .select("task_id, user_id, started_at, ended_at")
    .in("task_id", taskIds);
  if (error) {
    console.error("Failed to load board timesheet:", error.message);
    return tasks;
  }
  const entries = (rows ?? []) as { task_id: string; user_id: string | null; started_at: string; ended_at: string | null }[];

  const userIds = [...new Set(entries.map((e) => e.user_id).filter((v): v is string => !!v))];
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: people } = await db.from("profiles").select("user_id, full_name").in("user_id", userIds);
    for (const p of (people ?? []) as { user_id: string; full_name: string | null }[]) {
      if (p.full_name) nameByUser.set(p.user_id, p.full_name);
    }
  }

  const byTask = new Map<string, NonNullable<Task["time_entries"]>>();
  for (const e of entries) {
    const bucket = byTask.get(e.task_id) ?? [];
    bucket.push({
      user_id: e.user_id,
      started_at: e.started_at,
      ended_at: e.ended_at,
      name: e.user_id ? (nameByUser.get(e.user_id) ?? null) : null,
    });
    byTask.set(e.task_id, bucket);
  }
  return tasks.map((t) => ({ ...t, time_entries: byTask.get(t.id) ?? [] }));
}

/** Batch-attaches `tags` to each task in one extra query — same
 *  "second query + map" shape as loadPipelineDeals' line-items/tags. */
async function hydrateTaskTags(db: SupabaseClient, tasks: Task[]): Promise<Task[]> {
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) return tasks;

  const { data: tags } = await db.from("task_tags").select("*").in("task_id", taskIds);
  const tagsByTask = new Map<string, TaskTag[]>();
  for (const tag of (tags ?? []) as TaskTag[]) {
    const bucket = tagsByTask.get(tag.task_id) ?? [];
    bucket.push(tag);
    tagsByTask.set(tag.task_id, bucket);
  }

  return tasks.map((t) => ({ ...t, tags: tagsByTask.get(t.id) ?? [] }));
}

export async function loadSubtasks(db: SupabaseClient, parentTaskId: string): Promise<Task[]> {
  const { data, error } = await db
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(*)")
    .eq("parent_task_id", parentTaskId)
    .order("created_at");
  if (error) {
    console.error("Failed to load subtasks:", error.message);
    return [];
  }
  return (data ?? []) as Task[];
}

/** Account members eligible as assignee/participant options — same
 *  point-lookup style as other member pickers in the app. */
export async function loadAccountProfiles(db: SupabaseClient, accountId: string): Promise<Profile[]> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("account_id", accountId)
    .order("full_name");
  if (error) {
    console.error("Failed to load account profiles:", error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}

export async function loadTaskComments(db: SupabaseClient, taskId: string): Promise<TaskComment[]> {
  const { data, error } = await db
    .from("task_comments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at");
  if (error) {
    console.error("Failed to load task comments:", error.message);
    return [];
  }
  let comments = (data ?? []) as TaskComment[];

  // task_comments.user_id references auth.users (not profiles) — same
  // "second query + map" hydration as loadDealComments.
  const userIds = [...new Set(comments.map((c) => c.user_id).filter((v): v is string => !!v))];
  if (userIds.length > 0) {
    const { data: authors } = await db.from("profiles").select("*").in("user_id", userIds);
    const authorByUserId = new Map(((authors ?? []) as Profile[]).map((p) => [p.user_id, p]));
    comments = comments.map((c) => ({ ...c, author: c.user_id ? authorByUserId.get(c.user_id) : undefined }));
  }
  return comments;
}

export async function loadTaskChecklist(db: SupabaseClient, taskId: string): Promise<TaskChecklistItem[]> {
  const { data, error } = await db
    .from("task_checklist_items")
    .select("*")
    .eq("task_id", taskId)
    .order("position");
  if (error) {
    console.error("Failed to load task checklist:", error.message);
    return [];
  }
  return (data ?? []) as TaskChecklistItem[];
}

export async function loadTaskApprovals(db: SupabaseClient, taskId: string): Promise<TaskApproval[]> {
  const { data, error } = await db
    .from("task_approvals")
    .select("*")
    .eq("task_id", taskId)
    .order("requested_at", { ascending: false });
  if (error) {
    console.error("Failed to load task approvals:", error.message);
    return [];
  }
  let approvals = (data ?? []) as TaskApproval[];

  const profileIds = [...new Set(approvals.map((a) => a.requested_to).filter((v): v is string => !!v))];
  if (profileIds.length > 0) {
    const { data: profiles } = await db.from("profiles").select("*").in("id", profileIds);
    const profileById = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));
    approvals = approvals.map((a) => ({
      ...a,
      requested_to_profile: a.requested_to ? profileById.get(a.requested_to) : undefined,
    }));
  }
  return approvals;
}

/** Account-wide reads for the Dashboard Operacional (Etapa 3, fase 5) —
 *  one batch load each instead of per-board/per-task, since the
 *  dashboard aggregates across every board the account has. */
export async function loadAccountTasksForDashboard(db: SupabaseClient, accountId: string): Promise<Task[]> {
  const { data, error } = await db
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(*)")
    .eq("account_id", accountId)
    .is("parent_task_id", null);
  if (error) {
    console.error("Failed to load account tasks for dashboard:", error.message);
    return [];
  }
  return (data ?? []) as Task[];
}

export async function loadAccountTimesheetEntries(db: SupabaseClient, accountId: string): Promise<TimesheetEntry[]> {
  const { data, error } = await db.from("timesheet_entries").select("*").eq("account_id", accountId);
  if (error) {
    console.error("Failed to load account timesheet entries:", error.message);
    return [];
  }
  return (data ?? []) as TimesheetEntry[];
}

export async function loadAccountTaskStageHistory(db: SupabaseClient, accountId: string): Promise<TaskStageHistory[]> {
  const { data, error } = await db.from("task_stage_history").select("*").eq("account_id", accountId);
  if (error) {
    console.error("Failed to load account task stage history:", error.message);
    return [];
  }
  return (data ?? []) as TaskStageHistory[];
}

/** Sector ids the given profile belongs to — resolves the "sector" level
 *  of the Dashboard/Timesheet 3-level permission split (migration 067). */
export async function loadMySectorIds(db: SupabaseClient, profileId: string): Promise<string[]> {
  const { data, error } = await db.from("user_sectors").select("sector_id").eq("profile_id", profileId);
  if (error) {
    console.error("Failed to load user sectors:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.sector_id as string);
}

export async function loadTaskActivity(db: SupabaseClient, taskId: string): Promise<TaskActivity[]> {
  const { data, error } = await db
    .from("task_activity")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Failed to load task activity:", error.message);
    return [];
  }
  let rows = (data ?? []) as TaskActivity[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  if (userIds.length > 0) {
    const { data: authors } = await db.from("profiles").select("*").in("user_id", userIds);
    const authorByUserId = new Map(((authors ?? []) as Profile[]).map((p) => [p.user_id, p]));
    rows = rows.map((r) => ({ ...r, author: r.user_id ? authorByUserId.get(r.user_id) : undefined }));
  }
  return rows;
}

export async function loadTaskTimesheet(db: SupabaseClient, taskId: string): Promise<TimesheetEntry[]> {
  const { data, error } = await db
    .from("timesheet_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false });
  if (error) {
    console.error("Failed to load task timesheet:", error.message);
    return [];
  }
  let rows = (data ?? []) as TimesheetEntry[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  if (userIds.length > 0) {
    const { data: authors } = await db.from("profiles").select("*").in("user_id", userIds);
    const authorByUserId = new Map(((authors ?? []) as Profile[]).map((p) => [p.user_id, p]));
    rows = rows.map((r) => ({ ...r, author: r.user_id ? authorByUserId.get(r.user_id) : undefined }));
  }
  return rows;
}

/** The caller's single account-wide active timer (if any), with the
 *  parent task's title/board hydrated so the Header indicator can show
 *  and link to it without a second round trip. */
export async function loadActiveTimer(db: SupabaseClient, userId: string): Promise<TimesheetEntry | null> {
  const { data, error } = await db
    .from("timesheet_entries")
    .select("*, task:tasks(id, title, board_id)")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) {
    console.error("Failed to load active timer:", error.message);
    return null;
  }
  return (data as TimesheetEntry | null) ?? null;
}

export async function loadTaskRecurrenceRule(db: SupabaseClient, taskId: string): Promise<TaskRecurrenceRule | null> {
  const { data, error } = await db
    .from("task_recurrence_rules")
    .select("*")
    .eq("template_task_id", taskId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load task recurrence rule:", error.message);
    return null;
  }
  return (data as TaskRecurrenceRule | null) ?? null;
}

export async function loadTaskStageHistory(db: SupabaseClient, taskId: string): Promise<TaskStageHistory[]> {
  const { data, error } = await db
    .from("task_stage_history")
    .select("*")
    .eq("task_id", taskId)
    .order("changed_at", { ascending: false });
  if (error) {
    console.error("Failed to load task stage history:", error.message);
    return [];
  }
  return (data ?? []) as TaskStageHistory[];
}
