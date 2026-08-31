import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertPipelineOwnership } from "@/lib/prospecting/tools/pipelines";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";
import { PROSPECTING_MAX_QUANTITY, PROSPECTING_MIN_QUANTITY } from "@/lib/prospecting/constants";

/**
 * GET /api/prospecting/conversations/[id]
 *
 * Returns the conversation plus its full message history — reopening
 * a conversation after closing the tab replays everything from here,
 * since the SSE connection itself carries no state of its own.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data: conversation, error: convError } = await supabase
      .from("prospecting_conversations")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (convError) {
      console.error("[prospecting/conversations/[id] GET] fetch error:", convError);
      return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { data: messages, error: msgError } = await supabase
      .from("prospecting_messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (msgError) {
      console.error("[prospecting/conversations/[id] GET] messages fetch error:", msgError);
      return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
    }

    return NextResponse.json({ conversation, messages: messages ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/prospecting/conversations/[id]  (agent+)
 *
 * Updates the conversation's selections (pipeline/owner/frente/quantity)
 * or archives it. Every id is re-verified against this account.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

    const { data: existing } = await supabase
      .from("prospecting_conversations")
      .select("id")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const update: Record<string, unknown> = {};

    if ("title" in body) update.title = typeof body.title === "string" ? body.title.trim() || null : null;

    if ("selected_pipeline_id" in body) {
      const pipelineId = typeof body.selected_pipeline_id === "string" ? body.selected_pipeline_id : null;
      if (pipelineId) await assertPipelineOwnership(supabase, accountId, pipelineId);
      update.selected_pipeline_id = pipelineId;
    }

    if ("selected_owner_id" in body) {
      const ownerId = typeof body.selected_owner_id === "string" ? body.selected_owner_id : null;
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
      update.selected_owner_id = ownerId;
    }

    if ("selected_frente_leadgen" in body) update.selected_frente_leadgen = body.selected_frente_leadgen === true;
    if ("selected_frente_avr" in body) update.selected_frente_avr = body.selected_frente_avr === true;

    if ("requested_quantity" in body) {
      const n = Number(body.requested_quantity);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "requested_quantity must be a number" }, { status: 400 });
      }
      update.requested_quantity = Math.min(PROSPECTING_MAX_QUANTITY, Math.max(PROSPECTING_MIN_QUANTITY, Math.floor(n)));
    }

    if ("status" in body) {
      if (body.status !== "active" && body.status !== "archived") {
        return NextResponse.json({ error: "status must be 'active' or 'archived'" }, { status: 400 });
      }
      update.status = body.status;
    }

    const { data, error } = await supabase
      .from("prospecting_conversations")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      console.error("[prospecting/conversations/[id] PATCH] update error:", error);
      return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
    }
    return NextResponse.json({ conversation: data });
  } catch (err) {
    if (err instanceof ProspectingToolError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
