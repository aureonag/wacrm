// Reads Meta for a client and saves the result as a report. Used by the manual
// "Gerar relatório" and by the scheduled automations, so both save the same thing.

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";
import type { ReportSnapshot } from "@/lib/reportei/report";

export type CreateReportResult =
  | { ok: true; id: string }
  | { ok: false; reason: "no_integrations" | "unreadable" | "db_error" };

export async function createSavedReport(
  db: SupabaseClient,
  input: {
    accountId: string;
    clientId: string;
    title: string;
    range: { since: string; until: string };
    compare: { since: string; until: string } | null;
    createdBy: string | null;
    /** Automations save the report already shared, with the link ready to copy. */
    auto?: boolean;
  },
): Promise<CreateReportResult> {
  let accounts;
  try {
    accounts = await collectAccountSnapshots({ supabase: db, accountId: input.accountId }, input.clientId, { ...input.range, compare: input.compare, daily: true });
  } catch (err) {
    console.error("[reportei createSavedReport] collect", err instanceof Error ? err.message : err);
    return { ok: false, reason: "db_error" };
  }
  if (accounts.length === 0) return { ok: false, reason: "no_integrations" };
  if (accounts.every((a) => a.error)) return { ok: false, reason: "unreadable" };

  const snapshot: ReportSnapshot = { period: input.range, compare: input.compare, accounts };
  const { data, error } = await db
    .from("reportei_reports")
    .insert({
      account_id: input.accountId,
      client_id: input.clientId,
      title: input.title,
      period_start: input.range.since,
      period_end: input.range.until,
      compare_start: input.compare?.since ?? null,
      compare_end: input.compare?.until ?? null,
      snapshot,
      created_by: input.createdBy,
      auto: input.auto === true,
      ...(input.auto ? { share_token: randomBytes(32).toString("base64url"), shared_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[reportei createSavedReport] insert", error?.message);
    return { ok: false, reason: "db_error" };
  }
  return { ok: true, id: data.id as string };
}
