// Operacional → Clientes: which board stages mean "finished" and when each task
// reached one. Server only (it reads with the caller's own session, so RLS
// scopes everything to their account).
//
// Why this exists: dragging a card into "Concluído" changes its stage but not
// its `status`, so counts built from `status` alone left delivered tasks
// showing as open / overdue.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDoneStageName } from "@/lib/operational/clients-projects";

/** Ids of the finished stages ("Concluído", "Finalizado"…) the caller can see. */
export async function loadDoneStageIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("board_stages").select("id, name").limit(5000);
  if (error) throw new Error(`board_stages: ${error.message}`);
  return new Set((data ?? []).filter((s) => isDoneStageName(s.name as string)).map((s) => s.id as string));
}

const CHUNK = 100;
const saoPauloDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * For tasks that sit in a finished stage: the São Paulo day each one last
 * entered a finished stage (YYYY-MM-DD). Used to tell "delivered on time"
 * from "delivered late". A task with no history row is simply absent.
 */
export async function loadStageCompletionDays(
  supabase: SupabaseClient,
  taskIds: string[],
  doneStageIds: Set<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (taskIds.length === 0 || doneStageIds.size === 0) return out;
  for (let i = 0; i < taskIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("task_stage_history")
      .select("task_id, to_stage_id, changed_at")
      .in("task_id", taskIds.slice(i, i + CHUNK))
      .order("changed_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(`task_stage_history: ${error.message}`);
    for (const h of data ?? []) {
      // Rows come oldest → newest: the last one into a finished stage wins.
      if (doneStageIds.has(h.to_stage_id as string)) {
        out.set(h.task_id as string, saoPauloDay.format(new Date(h.changed_at as string)));
      }
    }
  }
  return out;
}
