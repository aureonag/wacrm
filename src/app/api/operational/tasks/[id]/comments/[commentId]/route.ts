// PATCH  /api/operational/tasks/[id]/comments/[commentId] — edit the text of
//        your OWN comment (migration 108: RLS only lets the author update,
//        and the database stamps `edited_at`). Requires operational:tasks:comment.
// DELETE /api/operational/tasks/[id]/comments/[commentId] — remove a
//        comment. Requires operational:tasks:comment.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const { id: taskId, commentId } = await params;
    const ctx = await requirePermission("operational", "tasks", "comment");

    const limit = checkRateLimit(`operational:commentEdit:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const payload = (await request.json().catch(() => null)) as { body?: unknown; mentioned_profile_ids?: unknown } | null;
    const text = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!text) return NextResponse.json({ error: "'body' is required" }, { status: 400 });

    // Only the author's own row matches (also enforced by RLS).
    const { data, error } = await ctx.supabase
      .from("task_comments")
      .update({ body: text })
      .eq("id", commentId)
      .eq("task_id", taskId)
      .eq("account_id", ctx.accountId)
      .eq("user_id", ctx.userId)
      .select("id, edited_at")
      .maybeSingle();

    if (error) {
      console.error("[PATCH .../comments/[commentId]] update error:", error);
      return NextResponse.json({ error: "Failed to edit comment" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    const requested = Array.isArray(payload?.mentioned_profile_ids)
      ? (payload.mentioned_profile_ids as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 20)
      : [];
    if (requested.length > 0) {
      const { data: people } = await ctx.supabase
        .from("profiles")
        .select("id")
        .in("id", requested)
        .eq("account_id", ctx.accountId);
      const ids = (people ?? []).map((p) => p.id as string);
      if (ids.length > 0) {
        // ON CONFLICT DO NOTHING: whoever was already mentioned is not notified twice.
        await ctx.supabase
          .from("task_comment_mentions")
          .upsert(ids.map((profileId) => ({ comment_id: commentId, profile_id: profileId })), {
            onConflict: "comment_id,profile_id",
            ignoreDuplicates: true,
          });
      }
    }

    return NextResponse.json({ ok: true, edited_at: data.edited_at });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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
