import type { SupabaseClient } from "@supabase/supabase-js";
import { applyColumnOrder, moveInOrder } from "./column-order";

/**
 * "Mover para o topo da etapa" for the signed-in person only: puts the task first
 * in their own order of the column (the shared position is not touched).
 * Used where the board's state is not at hand (inside the task panel).
 */
export async function moveTaskToTopForUser(
  supabase: SupabaseClient,
  args: { userId: string; accountId: string; stageId: string; taskId: string },
): Promise<boolean> {
  const { userId, accountId, stageId, taskId } = args;
  const [{ data: rows }, { data: saved }] = await Promise.all([
    supabase.from("tasks").select("id").eq("stage_id", stageId).is("parent_task_id", null).order("position"),
    supabase.from("user_column_order").select("item_ids").eq("user_id", userId).eq("stage_id", stageId).maybeSingle(),
  ]);
  const natural = ((rows ?? []) as { id: string }[]).map((r) => ({ id: r.id }));
  const column = applyColumnOrder(natural, (saved as { item_ids: string[] } | null)?.item_ids).map((i) => i.id);
  const { error } = await supabase.from("user_column_order").upsert(
    {
      user_id: userId,
      account_id: accountId,
      scope: "task",
      stage_id: stageId,
      item_ids: moveInOrder(column, taskId, "top"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,stage_id" },
  );
  return !error;
}
