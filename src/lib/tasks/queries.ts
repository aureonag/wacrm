import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Board,
  BoardStage,
  Profile,
  Task,
  TaskActivity,
  TaskChecklistItem,
  TaskComment,
  TaskStageHistory,
  TaskTag,
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
  return hydrateTaskTags(db, (data ?? []) as Task[]);
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
