// Reads one template of an account; shared by the report and automation routes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { templateFromRow, type Template } from "@/lib/reportei/template";

export const TEMPLATE_COLUMNS = "id, name, metrics, chart, chart_metrics, compare, intro";

const UUID = /^[0-9a-f-]{36}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The template, or null when it does not exist in this account (or the read failed). */
export async function loadTemplate(db: SupabaseClient, accountId: string, id: string): Promise<Template | null> {
  const { data, error } = await db.from("reportei_templates").select(TEMPLATE_COLUMNS).eq("id", id).eq("account_id", accountId).maybeSingle();
  if (error) console.error("[reportei loadTemplate]", error.message);
  return data ? templateFromRow(data) : null;
}
