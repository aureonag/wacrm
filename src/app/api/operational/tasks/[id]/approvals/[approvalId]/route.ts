// PATCH /api/operational/tasks/[id]/approvals/[approvalId] — approve or
//       reject a pending approval request. RLS (task_approvals_update)
//       already restricts this to the recipient (requested_to) or someone
//       with operational:tasks:approve — this route just needs to be
//       authenticated and validate the request shape; the database is the
//       real gate.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; approvalId: string }> },
) {
  try {
    const { id: taskId, approvalId } = await params;
    const ctx = await requirePermission("operational", "tasks", "view_tasks");

    const limit = checkRateLimit(`operational:approvalDecide:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
    if (body?.status !== "approved" && body?.status !== "rejected") {
      return NextResponse.json({ error: "'status' must be 'approved' or 'rejected'" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("task_approvals")
      .update({ status: body.status, decided_at: new Date().toISOString(), decided_by: ctx.userId })
      .eq("id", approvalId)
      .eq("task_id", taskId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("[PATCH .../approvals/[approvalId]] update error:", error);
      return NextResponse.json({ error: "Failed to decide approval" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Approval not found, already decided, or you're not allowed to decide it" },
        { status: 404 },
      );
    }

    return NextResponse.json({ approval: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
