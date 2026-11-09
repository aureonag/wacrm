// Bell notifications of the automations: "report ready" and "could not generate".
// Rows are inserted by the server (service role), like every other notification.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Frequency } from "@/lib/reportei/automation";
import { showDate } from "@/lib/reportei/format";

const KIND: Record<Frequency, string> = { daily: "diário", weekly: "semanal", biweekly: "quinzenal", monthly: "mensal" };

export type AutomationFailure = "no_integrations" | "unreadable" | "request_failed";

const FAILURE_TEXT: Record<AutomationFailure, string> = {
  no_integrations: "o cliente não tem conta de anúncios ligada",
  unreadable: "não consegui ler nenhuma conta na Meta, confira a conexão",
  request_failed: "falha ao gerar, tento de novo no próximo dia",
};

export function readyNotification(frequency: Frequency, clientName: string, range: { since: string; until: string }) {
  return {
    type: "report_ready" as const,
    title: `Relatório ${KIND[frequency]} de ${clientName} pronto`,
    body: `${showDate(range.since)} a ${showDate(range.until)}. O link público já está pronto para copiar.`,
  };
}

export function failedNotification(clientName: string, reason: AutomationFailure) {
  return {
    type: "report_failed" as const,
    title: `Não consegui gerar o relatório de ${clientName}`,
    body: FAILURE_TEXT[reason],
  };
}

/** Never throws: a missing bell notice must not undo a report that was generated. */
export async function notifyAutomation(
  db: SupabaseClient,
  input: { accountId: string; userId: string | null; reportId?: string; notice: { type: "report_ready" | "report_failed"; title: string; body: string } },
): Promise<void> {
  if (!input.userId) return;
  try {
    const { data: enabled } = await db.rpc("notification_enabled", { p_user_id: input.userId, p_type: input.notice.type });
    if (enabled === false) return;
    const { error } = await db.from("notifications").insert({
      account_id: input.accountId,
      user_id: input.userId,
      type: input.notice.type,
      title: input.notice.title,
      body: input.notice.body,
      report_id: input.reportId ?? null,
    });
    if (error) console.error("[reportei notify]", error.message);
  } catch (err) {
    console.error("[reportei notify]", err instanceof Error ? err.message : err);
  }
}
