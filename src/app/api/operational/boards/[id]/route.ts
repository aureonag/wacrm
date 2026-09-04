// PATCH  /api/operational/boards/[id] — rename/edit a board. Requires
//        operational:tasks:edit_boards.
// DELETE /api/operational/boards/[id] — delete a board. Requires
//        operational:tasks:delete_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const limit = checkRateLimit(`operational:boardEdit:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; description?: unknown }
      | null;
    const update: Record<string, string | null> = {};
    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      update.name = name;
    }
    if (typeof body?.description === "string" || body?.description === null) {
      update.description = body.description as string | null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("boards")
      .update(update)
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[PATCH /api/operational/boards/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update board" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission("operational", "tasks", "delete_boards");

    const limit = checkRateLimit(`operational:boardDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from("boards")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/operational/boards/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete board" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
