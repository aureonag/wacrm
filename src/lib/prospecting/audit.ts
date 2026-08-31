import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Prospecting: audit trail writer.
//
// The single choke point that sanitizes before insert — mirrors
// `logAiUsage`'s "best-effort, never throw" discipline (an audit
// write must never fail the primary action it's documenting).
// Callers should pass the SERVICE-ROLE client — `prospecting_audit_
// logs` (migration 048) has no client-writable policy.
// ============================================================

export interface ProspectingAuditArgs {
  accountId: string;
  userId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  action: string;
  pipelineId?: string | null;
  quantity?: number | null;
  provider?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  error?: string | null;
}

const SENSITIVE_KEY_PATTERN = /key|token|secret|authorization|password/i;
const MAX_TEXT_LENGTH = 2000;

function sanitizeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue; // never api_key/token/etc, even accidentally passed in
    out[key] = typeof value === "string" && value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
  }
  return out;
}

export async function logProspectingAudit(admin: SupabaseClient, args: ProspectingAuditArgs): Promise<void> {
  try {
    const { error } = await admin.from("prospecting_audit_logs").insert({
      account_id: args.accountId,
      user_id: args.userId ?? null,
      conversation_id: args.conversationId ?? null,
      run_id: args.runId ?? null,
      action: args.action,
      pipeline_id: args.pipelineId ?? null,
      quantity: args.quantity ?? null,
      provider: args.provider ?? null,
      status: args.status,
      metadata: sanitizeMetadata(args.metadata),
      error: args.error ? args.error.slice(0, MAX_TEXT_LENGTH) : null,
    });
    if (error) console.error("[prospecting audit] insert failed:", error);
  } catch (err) {
    console.error("[prospecting audit] insert threw:", err);
  }
}
