// POST   /api/operational/tasks/[id]/recurrence — create or replace the
//        recurrence rule for a task (the task becomes its "template").
//        Requires operational:tasks:edit_tasks.
// DELETE /api/operational/tasks/[id]/recurrence — stop recurring (removes
//        the rule; tasks already spawned from it are untouched).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { computeInitialNextRunAt, type RecurrenceRuleType } from "@/lib/tasks/recurrence";

const RULE_TYPES: RecurrenceRuleType[] = ["weekly", "monthly_day", "monthly_first_business_day"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:taskRecurrence:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as
      | { rule_type?: unknown; weekday?: unknown; day_of_month?: unknown }
      | null;
    if (!body || typeof body.rule_type !== "string" || !RULE_TYPES.includes(body.rule_type as RecurrenceRuleType)) {
      return NextResponse.json({ error: "'rule_type' must be one of: " + RULE_TYPES.join(", ") }, { status: 400 });
    }
    const ruleType = body.rule_type as RecurrenceRuleType;

    let weekday: number | null = null;
    let dayOfMonth: number | null = null;
    if (ruleType === "weekly") {
      if (typeof body.weekday !== "number" || body.weekday < 0 || body.weekday > 6) {
        return NextResponse.json({ error: "'weekday' (0-6) is required for 'weekly'" }, { status: 400 });
      }
      weekday = body.weekday;
    } else if (ruleType === "monthly_day") {
      if (typeof body.day_of_month !== "number" || body.day_of_month < 1 || body.day_of_month > 31) {
        return NextResponse.json({ error: "'day_of_month' (1-31) is required for 'monthly_day'" }, { status: 400 });
      }
      dayOfMonth = body.day_of_month;
    }

    const nextRunAt = computeInitialNextRunAt({ ruleType, weekday, dayOfMonth });

    const { data: rule, error } = await ctx.supabase
      .from("task_recurrence_rules")
      .upsert(
        {
          account_id: ctx.accountId,
          template_task_id: taskId,
          rule_type: ruleType,
          weekday,
          day_of_month: dayOfMonth,
          next_run_at: nextRunAt,
          active: true,
          created_by: ctx.userId,
        },
        { onConflict: "template_task_id" },
      )
      .select("*")
      .single();

    if (error) {
      console.error("[POST .../recurrence] upsert error:", error);
      return NextResponse.json({ error: "Failed to save recurrence rule" }, { status: 500 });
    }

    return NextResponse.json(rule);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:taskRecurrence:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from("task_recurrence_rules")
      .delete()
      .eq("template_task_id", taskId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE .../recurrence] delete error:", error);
      return NextResponse.json({ error: "Failed to remove recurrence rule" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
