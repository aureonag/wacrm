import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertPipelineOwnership } from "@/lib/prospecting/tools/pipelines";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";
import { PROSPECTING_DEFAULT_QUANTITY, PROSPECTING_MAX_QUANTITY, PROSPECTING_MIN_QUANTITY } from "@/lib/prospecting/constants";

/**
 * GET /api/prospecting/conversations
 *
 * Lists the account's prospecting conversations, newest first. Any
 * member (viewer+) may read — writing/chatting requires agent+.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("prospecting_conversations")
      .select("*")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[prospecting/conversations GET] fetch error:", error);
      return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
    }
    return NextResponse.json({ conversations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function clampQuantity(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return PROSPECTING_DEFAULT_QUANTITY;
  return Math.min(PROSPECTING_MAX_QUANTITY, Math.max(PROSPECTING_MIN_QUANTITY, Math.floor(n)));
}

/**
 * POST /api/prospecting/conversations  (agent+)
 *
 * Creates a new conversation with the user's initial selections. All
 * ids are re-verified against this account before being stored — a
 * pipeline id from another account is rejected here, not just left to
 * RLS to silently drop.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    const pipelineId = typeof body?.selected_pipeline_id === "string" ? body.selected_pipeline_id : null;
    if (pipelineId) {
      await assertPipelineOwnership(supabase, accountId, pipelineId);
    }

    const ownerId = typeof body?.selected_owner_id === "string" ? body.selected_owner_id : null;
    if (ownerId) {
      const { data: member } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("account_id", accountId)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (!member) {
        return NextResponse.json({ error: "selected_owner_id must be a member of this account" }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from("prospecting_conversations")
      .insert({
        account_id: accountId,
        user_id: userId,
        title: typeof body?.title === "string" ? body.title.trim() || null : null,
        selected_pipeline_id: pipelineId,
        selected_owner_id: ownerId,
        selected_frente_leadgen: body?.selected_frente_leadgen === true,
        selected_frente_avr: body?.selected_frente_avr === true,
        requested_quantity: clampQuantity(body?.requested_quantity),
      })
      .select()
      .single();

    if (error || !data) {
      console.error("[prospecting/conversations POST] insert error:", error);
      return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
    }
    return NextResponse.json({ conversation: data });
  } catch (err) {
    if (err instanceof ProspectingToolError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
