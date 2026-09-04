// GET /api/operational/handoff-defaults — read the account's Comercial->
//     Operacional handoff defaults (board/stage/sector/assignee used to
//     auto-create a kickoff task when a deal is marked won). Requires
//     operational:tasks:edit_boards (same admin-ish gate as board
//     structure changes — this is account-wide config, not a per-board
//     setting).
// PUT /api/operational/handoff-defaults — upsert those defaults.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const { data, error } = await ctx.supabase
      .from("operational_handoff_defaults")
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/operational/handoff-defaults] read error:", error);
      return NextResponse.json({ error: "Failed to load handoff defaults" }, { status: 500 });
    }

    return NextResponse.json({ defaults: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:handoffDefaults:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    if (typeof body.board_id !== "string" || typeof body.initial_stage_id !== "string") {
      return NextResponse.json({ error: "'board_id' and 'initial_stage_id' are required" }, { status: 400 });
    }

    const { data: stage } = await ctx.supabase
      .from("board_stages")
      .select("id")
      .eq("id", body.initial_stage_id)
      .eq("board_id", body.board_id)
      .maybeSingle();
    if (!stage) return NextResponse.json({ error: "Stage not found on this board" }, { status: 400 });

    const update: Record<string, unknown> = {
      account_id: ctx.accountId,
      board_id: body.board_id,
      initial_stage_id: body.initial_stage_id,
      default_sector_id: typeof body.default_sector_id === "string" ? body.default_sector_id : null,
      default_assignee_id: typeof body.default_assignee_id === "string" ? body.default_assignee_id : null,
      due_offset_days: typeof body.due_offset_days === "number" ? body.due_offset_days : null,
    };
    if (typeof body.title_template === "string" && body.title_template.trim()) {
      update.title_template = body.title_template.trim();
    }

    const { error } = await ctx.supabase
      .from("operational_handoff_defaults")
      .upsert(update, { onConflict: "account_id" });

    if (error) {
      console.error("[PUT /api/operational/handoff-defaults] upsert error:", error);
      return NextResponse.json({ error: "Failed to save handoff defaults" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
