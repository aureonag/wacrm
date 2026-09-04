// PATCH /api/operational/boards/[id]/stages/reorder — bulk-rewrite stage
//       positions after a drag reorder in the board settings UI (same
//       "one upsert on Save" shape as pipeline-settings.tsx uses for
//       pipeline_stages, just routed through an API call instead of a
//       direct client write). Requires operational:tasks:edit_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: boardId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:stageReorder:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: board } = await ctx.supabase
      .from("boards")
      .select("id")
      .eq("id", boardId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as { order?: unknown } | null;
    const order = Array.isArray(body?.order) ? (body.order as unknown[]) : null;
    if (!order || order.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "'order' must be an array of stage ids" }, { status: 400 });
    }

    const { data: existing } = await ctx.supabase
      .from("board_stages")
      .select("id, name, color")
      .eq("board_id", boardId);
    const existingById = new Map((existing ?? []).map((s) => [s.id, s]));
    if (order.length !== existingById.size || !(order as string[]).every((id) => existingById.has(id))) {
      return NextResponse.json({ error: "'order' must list every stage on this board exactly once" }, {
        status: 400,
      });
    }

    // Upsert needs the full row (not just id/position) — Postgres builds
    // the INSERT side of ON CONFLICT before resolving the conflict, so any
    // NOT NULL column left out (name) fails even though every row here
    // always hits the UPDATE path. Same reason pipeline-settings.tsx's
    // stage upsert always sends full rows, never a partial position patch.
    const { error } = await ctx.supabase.from("board_stages").upsert(
      (order as string[]).map((stageId, i) => {
        const s = existingById.get(stageId)!;
        return { id: stageId, board_id: boardId, name: s.name, color: s.color, position: i };
      }),
      { onConflict: "id" },
    );
    if (error) {
      console.error("[PATCH .../stages/reorder] upsert error:", error);
      return NextResponse.json({ error: "Failed to reorder stages" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
