// PATCH  /api/operational/tasks/[id]/checklist/[itemId] — toggle done or
//        rename a checklist item. Requires operational:tasks:edit_tasks.
// DELETE /api/operational/tasks/[id]/checklist/[itemId] — remove it.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: taskId, itemId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:checklistEdit:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { done?: unknown; label?: unknown }
      | null;
    const update: Record<string, string | boolean> = {};
    if (typeof body?.done === "boolean") update.done = body.done;
    if (typeof body?.label === "string") {
      const label = body.label.trim();
      if (!label) return NextResponse.json({ error: "'label' cannot be empty" }, { status: 400 });
      update.label = label;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("task_checklist_items")
      .update(update)
      .eq("id", itemId)
      .eq("task_id", taskId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[PATCH .../checklist/[itemId]] update error:", error);
      return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: taskId, itemId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:checklistDelete:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from("task_checklist_items")
      .delete()
      .eq("id", itemId)
      .eq("task_id", taskId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE .../checklist/[itemId]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete checklist item" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
