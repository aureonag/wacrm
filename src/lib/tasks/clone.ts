import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInitialNextRunAt, type RecurrenceRuleType } from "./recurrence";

// Duplicating a task copies EVERYTHING that describes it — the whole side column
// (members, client/project, sector, labels, dates, estimate, priority, delivery
// folder/link, recurrence) plus the briefing, checklist and subtasks. What is NOT
// copied is the history of the old one: comments, activity, time entries,
// approvals, stage history, status/completion and the task number (new tasks get
// the next one).

type TaskRow = Record<string, unknown>;

/** Columns of `tasks` copied as they are. A new column that describes the task has to be added here. */
export const CLONED_TASK_COLUMNS = [
  "account_id",
  "board_id",
  "stage_id",
  "contact_id",
  "sector_id",
  "project_id",
  "deal_id",
  "assignee_id",
  "priority",
  "is_urgent",
  "briefing",
  "start_date",
  "due_date",
  "estimated_minutes",
  "drive_folder_url",
] as const;

/** Subtasks of subtasks are followed only this deep, so a cycle can never loop forever. */
const MAX_SUBTASK_DEPTH = 3;

export interface TaskCloneContext {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
}

/** The `tasks` row for the copy: every copied column of `source`, plus what changes for the new one. */
export function buildClonedTaskRow(
  source: TaskRow,
  overrides: { title: string; parentTaskId: string | null; position: number; createdBy: string },
): TaskRow {
  const row: TaskRow = {};
  for (const column of CLONED_TASK_COLUMNS) row[column] = source[column] ?? null;
  row.title = overrides.title;
  row.parent_task_id = overrides.parentTaskId;
  row.position = overrides.position;
  row.created_by = overrides.createdBy;
  return row;
}

async function copyRelated(ctx: TaskCloneContext, sourceId: string, cloneId: string, warnings: string[]) {
  const { supabase, accountId } = ctx;

  const [checklist, tags, participants, rule] = await Promise.all([
    supabase.from("task_checklist_items").select("label, position").eq("task_id", sourceId),
    supabase.from("task_tags").select("label, color, label_id").eq("task_id", sourceId),
    supabase.from("task_participants").select("profile_id").eq("task_id", sourceId),
    supabase
      .from("task_recurrence_rules")
      .select("rule_type, weekday, day_of_month, active")
      .eq("template_task_id", sourceId)
      .maybeSingle(),
  ]);

  async function insert(table: string, rows: TaskRow[]) {
    if (rows.length === 0) return;
    const { error } = await supabase.from(table).insert(rows);
    if (error) {
      console.error(`[tasks/clone] copy to ${table} failed:`, error);
      warnings.push(table);
    }
  }

  // The checklist is copied as to-do: the new task has all of it still to do.
  await insert(
    "task_checklist_items",
    (checklist.data ?? []).map((i) => ({ task_id: cloneId, account_id: accountId, label: i.label, position: i.position })),
  );
  await insert(
    "task_tags",
    (tags.data ?? []).map((t) => ({ task_id: cloneId, account_id: accountId, label: t.label, color: t.color, label_id: t.label_id })),
  );
  await insert(
    "task_participants",
    (participants.data ?? []).map((p) => ({ task_id: cloneId, profile_id: p.profile_id })),
  );

  // A task that repeats keeps repeating: the copy gets its own rule, same schedule.
  if (rule.data) {
    const ruleType = rule.data.rule_type as RecurrenceRuleType;
    const weekday = (rule.data.weekday as number | null) ?? null;
    const dayOfMonth = (rule.data.day_of_month as number | null) ?? null;
    const { data: created, error } = await supabase
      .from("task_recurrence_rules")
      .insert({
        account_id: accountId,
        template_task_id: cloneId,
        rule_type: ruleType,
        weekday,
        day_of_month: dayOfMonth,
        next_run_at: computeInitialNextRunAt({ ruleType, weekday, dayOfMonth }),
        active: rule.data.active ?? true,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[tasks/clone] copy to task_recurrence_rules failed:", error);
      warnings.push("task_recurrence_rules");
    } else {
      await supabase.from("tasks").update({ recurrence_rule_id: created.id }).eq("id", cloneId);
    }
  }
}

async function cloneOne(
  ctx: TaskCloneContext,
  source: TaskRow,
  overrides: { title: string; parentTaskId: string | null; position: number },
  depth: number,
  warnings: string[],
): Promise<string> {
  const { data: clone, error } = await ctx.supabase
    .from("tasks")
    .insert(buildClonedTaskRow(source, { ...overrides, createdBy: ctx.userId }))
    .select("id")
    .single();
  if (error || !clone) throw error ?? new Error("clone insert returned no row");

  const sourceId = source.id as string;
  await copyRelated(ctx, sourceId, clone.id as string, warnings);

  if (depth < MAX_SUBTASK_DEPTH) {
    const { data: children } = await ctx.supabase
      .from("tasks")
      .select("*")
      .eq("account_id", ctx.accountId)
      .eq("parent_task_id", sourceId)
      .order("position");
    for (const child of children ?? []) {
      await cloneOne(
        ctx,
        child as TaskRow,
        { title: child.title as string, parentTaskId: clone.id as string, position: (child.position as number) ?? 0 },
        depth + 1,
        warnings,
      );
    }
  }

  return clone.id as string;
}

/**
 * Copies `source` (and its subtasks) into the same board and stage. The copy is a new open task
 * titled "<title> (cópia)". `warnings` lists the related tables that could not be copied (the task itself was).
 */
export async function cloneTaskTree(
  ctx: TaskCloneContext,
  source: TaskRow,
): Promise<{ id: string; warnings: string[] }> {
  const { count } = await ctx.supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", source.stage_id as string);

  const warnings: string[] = [];
  const id = await cloneOne(
    ctx,
    source,
    {
      title: `${source.title as string} (cópia)`,
      // A copy of a subtask stays under the same parent.
      parentTaskId: (source.parent_task_id as string | null) ?? null,
      position: count ?? 0,
    },
    0,
    warnings,
  );
  return { id, warnings };
}
