// POST /api/operational/boards/[id]/stages — create a stage on a board.
//      Requires operational:tasks:edit_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: boardId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:stageCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: board } = await ctx.supabase
      .from("boards")
      .select("id")
      .eq("id", boardId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown }
      | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const color = typeof body?.color === "string" ? body.color : "#64748b";
    if (!name) return NextResponse.json({ error: "'name' is required" }, { status: 400 });

    const { count } = await ctx.supabase
      .from("board_stages")
      .select("id", { count: "exact", head: true })
      .eq("board_id", boardId);

    const { data, error } = await ctx.supabase
      .from("board_stages")
      .insert({ board_id: boardId, name, color, position: count ?? 0 })
      .select("id")
      .single();

    if (error) {
      console.error("[POST /api/operational/boards/[id]/stages] insert error:", error);
      return NextResponse.json({ error: "Failed to create stage" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
