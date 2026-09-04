// GET  /api/operational/tasks/[id]/approvals — list approval requests for a
//      task, most recent first. Requires operational:tasks:view_tasks.
// POST /api/operational/tasks/[id]/approvals — request approval on a task
//      (who should decide + optional comment). Requires edit_tasks or
//      comment (same bar as leaving a comment on the task).

import { NextResponse } from "next/server";
import { ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

async function assertTaskOnAccount(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  taskId: string,
  accountId: string,
) {
  const { data } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("account_id", accountId)
    .maybeSingle();
  return !!data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "view_tasks");

    if (!(await assertTaskOnAccount(ctx.supabase, taskId, ctx.accountId))) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from("task_approvals")
      .select("*")
      .eq("task_id", taskId)
      .order("requested_at", { ascending: false });
    if (error) {
      console.error("[GET .../tasks/[id]/approvals] select error:", error);
      return NextResponse.json({ error: "Failed to load approvals" }, { status: 500 });
    }

    return NextResponse.json({ approvals: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await (async () => {
      try {
        return await requirePermission("operational", "tasks", "edit_tasks");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return requirePermission("operational", "tasks", "comment");
        }
        throw err;
      }
    })();

    const limit = checkRateLimit(`operational:approvalRequest:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    if (!(await assertTaskOnAccount(ctx.supabase, taskId, ctx.accountId))) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { requested_to?: unknown; comment?: unknown }
      | null;
    if (typeof body?.requested_to !== "string" || !body.requested_to) {
      return NextResponse.json({ error: "'requested_to' is required" }, { status: 400 });
    }

    const { data: recipient } = await ctx.supabase
      .from("profiles")
      .select("id")
      .eq("id", body.requested_to)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!recipient) return NextResponse.json({ error: "Recipient not found" }, { status: 400 });

    const comment = typeof body.comment === "string" ? body.comment.trim() || null : null;

    const { data, error } = await ctx.supabase
      .from("task_approvals")
      .insert({
        task_id: taskId,
        account_id: ctx.accountId,
        requested_by: ctx.userId,
        requested_to: body.requested_to,
        comment,
      })
      .select("*")
      .single();
    if (error) {
      console.error("[POST .../tasks/[id]/approvals] insert error:", error);
      return NextResponse.json({ error: "Failed to request approval" }, { status: 500 });
    }

    return NextResponse.json({ approval: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
