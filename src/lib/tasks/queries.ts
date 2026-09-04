import type { SupabaseClient } from "@supabase/supabase-js";
import type { Board, BoardStage, Profile, Task, TaskTag } from "@/types";

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
