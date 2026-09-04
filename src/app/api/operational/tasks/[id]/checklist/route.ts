// POST /api/operational/tasks/[id]/checklist — add a checklist item.
//      Requires operational:tasks:edit_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:checklistAdd:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "'label' is required" }, { status: 400 });

    const { count } = await ctx.supabase
      .from("task_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId);

    const { data, error } = await ctx.supabase
      .from("task_checklist_items")
      .insert({ task_id: taskId, account_id: ctx.accountId, label, position: count ?? 0 })
      .select("id")
      .single();

    if (error) {
      console.error("[POST .../checklist] insert error:", error);
      return NextResponse.json({ error: "Failed to add checklist item" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
