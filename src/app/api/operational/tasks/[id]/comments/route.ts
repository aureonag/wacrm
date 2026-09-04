// POST /api/operational/tasks/[id]/comments — add a comment (or a reply,
//      when `parent_comment_id` is set). Requires operational:tasks:comment.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "comment");

    const limit = checkRateLimit(`operational:comment:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as
      | { body?: unknown; parent_comment_id?: unknown; mentioned_profile_ids?: unknown }
      | null;
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) return NextResponse.json({ error: "'body' is required" }, { status: 400 });

    const { data: comment, error } = await ctx.supabase
      .from("task_comments")
      .insert({
        task_id: taskId,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        body: text,
        parent_comment_id: typeof body?.parent_comment_id === "string" ? body.parent_comment_id : null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST .../comments] insert error:", error);
      return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
    }

    const mentionedIds = Array.isArray(body?.mentioned_profile_ids)
      ? (body.mentioned_profile_ids as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (mentionedIds.length > 0) {
      await ctx.supabase
        .from("task_comment_mentions")
        .insert(mentionedIds.map((profileId) => ({ comment_id: comment.id, profile_id: profileId })));
    }

    return NextResponse.json({ id: comment.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
