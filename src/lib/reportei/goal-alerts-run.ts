// The daily check of the client goals (called by the automations cron): reads
// the current month on Meta for every client that has goals and warns, once per
// month and kind, the person who saved the goals.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLimit, summarizeClient } from "@/lib/reportei/dashboard";
import { alertsFor, monthOf } from "@/lib/reportei/goal-alerts";
import { goalsFromRow, readGoals } from "@/lib/reportei/goals";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";

export interface GoalAlertSummary {
  checked: number;
  alerted: number;
  failed: number;
}

/** Never throws: goal alerts must not break the report automations that run in the same ping. */
export async function runGoalAlerts(db: SupabaseClient, today: string): Promise<GoalAlertSummary> {
  const summary: GoalAlertSummary = { checked: 0, alerted: 0, failed: 0 };
  try {
    const { data, error } = await db
      .from("reportei_client_goals")
      .select("client_id, account_id, monthly_budget, max_cpc, updated_by, ops_clients(name)")
      .limit(1000);
    if (error) {
      console.error("[reportei goal alerts] list", error.message);
      return summary;
    }
    const since = `${monthOf(today)}-01`;
    const month = monthOf(today);

    await mapLimit(data ?? [], 3, async (row) => {
      summary.checked++;
      try {
        const goals = goalsFromRow(row);
        if (goals.monthlyBudget === null && goals.maxCpc === null) return;
        const client = Array.isArray(row.ops_clients) ? row.ops_clients[0] : row.ops_clients;
        const who = { clientId: row.client_id as string, name: (client?.name as string | undefined) ?? "", code: null };
        const accounts = await collectAccountSnapshots({ supabase: db, accountId: row.account_id as string }, who.clientId, { since, until: today });
        const s = summarizeClient(who, accounts);
        const reading = readGoals(s, goals, "this_month", today);
        if (!s.totals) return;
        const alerts = alertsFor(reading, { name: who.name, currency: s.currency }, goals, s.totals);

        for (const alert of alerts) {
          // The primary key (client, month, kind) is the "already warned" memory.
          const first = await db.from("reportei_goal_alerts").insert({ client_id: who.clientId, month, kind: alert.kind });
          if (first.error) {
            if (first.error.code !== "23505") console.error("[reportei goal alerts] mark", first.error.message);
            continue;
          }
          const userId = row.updated_by as string | null;
          if (!userId) continue;
          const { data: enabled } = await db.rpc("notification_enabled", { p_user_id: userId, p_type: "goal_alert" });
          if (enabled === false) continue;
          const sent = await db.from("notifications").insert({
            account_id: row.account_id,
            user_id: userId,
            type: "goal_alert",
            title: alert.title,
            body: alert.body,
            client_id: who.clientId,
          });
          if (sent.error) console.error("[reportei goal alerts] notify", sent.error.message);
          else summary.alerted++;
        }
      } catch (err) {
        summary.failed++;
        console.error("[reportei goal alerts] client", err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.error("[reportei goal alerts]", err instanceof Error ? err.message : err);
  }
  return summary;
}
