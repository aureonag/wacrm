// POST /api/operational/tasks/[id]/clone — duplicate a task into the same
//      board/stage with everything that describes it: members, client/project,
//      sector, labels, dates, delivery folder/link, recurrence, briefing,
//      checklist and subtasks (see src/lib/tasks/clone.ts). Requires
//      operational:tasks:create_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { cloneTaskTree } from "@/lib/tasks/clone";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "create_tasks");

    const limit = checkRateLimit(`operational:taskClone:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: source } = await ctx.supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!source) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    try {
      const { id, warnings } = await cloneTaskTree(
        { supabase: ctx.supabase, accountId: ctx.accountId, userId: ctx.userId },
        source,
      );
      return NextResponse.json({ id, ...(warnings.length > 0 ? { warnings } : {}) }, { status: 201 });
    } catch (error) {
      console.error("[POST .../clone] insert error:", error);
      return NextResponse.json({ error: "Failed to clone task" }, { status: 500 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
