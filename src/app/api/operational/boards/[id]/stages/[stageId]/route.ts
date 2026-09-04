// PATCH  /api/operational/boards/[id]/stages/[stageId] — rename/recolor/
//        reorder one stage. Requires operational:tasks:edit_boards.
// DELETE /api/operational/boards/[id]/stages/[stageId] — delete a stage.
//        Blocked (409) if it still has tasks — same guard the Comercial
//        pipeline-settings UI applies client-side, enforced here too.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

async function assertStageOnAccountBoard(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  boardId: string,
  stageId: string,
  accountId: string,
) {
  const { data } = await supabase
    .from("board_stages")
    .select("id, boards!inner(account_id)")
    .eq("id", stageId)
    .eq("board_id", boardId)
    .eq("boards.account_id", accountId)
    .maybeSingle();
  return !!data;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const { id: boardId, stageId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:stageEdit:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    if (!(await assertStageOnAccountBoard(ctx.supabase, boardId, stageId, ctx.accountId))) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: unknown;
          color?: unknown;
          position?: unknown;
          requires_file?: unknown;
          requires_checklist_complete?: unknown;
          requires_approval?: unknown;
        }
      | null;
    const update: Record<string, string | number | boolean> = {};
    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      update.name = name;
    }
    if (typeof body?.color === "string") update.color = body.color;
    if (typeof body?.position === "number") update.position = body.position;
    if (typeof body?.requires_file === "boolean") update.requires_file = body.requires_file;
    if (typeof body?.requires_checklist_complete === "boolean") {
      update.requires_checklist_complete = body.requires_checklist_complete;
    }
    if (typeof body?.requires_approval === "boolean") update.requires_approval = body.requires_approval;
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await ctx.supabase.from("board_stages").update(update).eq("id", stageId);
    if (error) {
      console.error("[PATCH .../stages/[stageId]] update error:", error);
      return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const { id: boardId, stageId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:stageDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    if (!(await assertStageOnAccountBoard(ctx.supabase, boardId, stageId, ctx.accountId))) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const { count } = await ctx.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Move or delete the tasks in this stage before deleting it" },
        { status: 409 },
      );
    }

    const { error } = await ctx.supabase.from("board_stages").delete().eq("id", stageId);
    if (error) {
      console.error("[DELETE .../stages/[stageId]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete stage" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
