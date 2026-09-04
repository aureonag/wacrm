// DELETE /api/operational/tasks/[id]/comments/[commentId] — remove a
//        comment. Requires operational:tasks:comment.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const { id: taskId, commentId } = await params;
    const ctx = await requirePermission("operational", "tasks", "comment");

    const limit = checkRateLimit(`operational:commentDelete:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from("task_comments")
      .delete()
      .eq("id", commentId)
      .eq("task_id", taskId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE .../comments/[commentId]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
