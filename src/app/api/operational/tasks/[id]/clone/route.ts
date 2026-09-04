// POST /api/operational/tasks/[id]/clone — duplicate a task (fields +
//      checklist) into the same board/stage. Requires
//      operational:tasks:create_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

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

    const { count } = await ctx.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", source.stage_id);

    const { data: clone, error } = await ctx.supabase
      .from("tasks")
      .insert({
        account_id: source.account_id,
        board_id: source.board_id,
        stage_id: source.stage_id,
        title: `${source.title} (cópia)`,
        contact_id: source.contact_id,
        sector_id: source.sector_id,
        assignee_id: source.assignee_id,
        priority: source.priority,
        is_urgent: source.is_urgent,
        briefing: source.briefing,
        start_date: source.start_date,
        due_date: source.due_date,
        estimated_minutes: source.estimated_minutes,
        created_by: ctx.userId,
        position: count ?? 0,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST .../clone] insert error:", error);
      return NextResponse.json({ error: "Failed to clone task" }, { status: 500 });
    }

    const { data: checklistItems } = await ctx.supabase
      .from("task_checklist_items")
      .select("label, position")
      .eq("task_id", taskId);
    if (checklistItems && checklistItems.length > 0) {
      await ctx.supabase.from("task_checklist_items").insert(
        checklistItems.map((i) => ({
          task_id: clone.id,
          account_id: ctx.accountId,
          label: i.label,
          position: i.position,
        })),
      );
    }

    const { data: tags } = await ctx.supabase.from("task_tags").select("label, color").eq("task_id", taskId);
    if (tags && tags.length > 0) {
      await ctx.supabase.from("task_tags").insert(
        tags.map((t) => ({ task_id: clone.id, account_id: ctx.accountId, label: t.label, color: t.color })),
      );
    }

    return NextResponse.json({ id: clone.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
