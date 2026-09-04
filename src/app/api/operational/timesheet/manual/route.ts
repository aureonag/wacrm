// POST /api/operational/timesheet/manual — log a completed time range
//      without running a live timer. Requires
//      operational:timesheet:log_manual.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("operational", "timesheet", "log_manual");

    const limit = checkRateLimit(`operational:timesheetManual:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { task_id?: unknown; started_at?: unknown; ended_at?: unknown; description?: unknown }
      | null;
    const taskId = typeof body?.task_id === "string" ? body.task_id : "";
    const startedAt = typeof body?.started_at === "string" ? body.started_at : "";
    const endedAt = typeof body?.ended_at === "string" ? body.ended_at : "";
    const description = typeof body?.description === "string" ? body.description.trim() || null : null;

    if (!taskId || !startedAt || !endedAt) {
      return NextResponse.json({ error: "'task_id', 'started_at' and 'ended_at' are required" }, { status: 400 });
    }
    const startDate = new Date(startedAt);
    const endDate = new Date(endedAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return NextResponse.json({ error: "'ended_at' must be a valid date after 'started_at'" }, { status: 400 });
    }

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("timesheet_entries")
      .insert({
        account_id: ctx.accountId,
        task_id: taskId,
        user_id: ctx.userId,
        is_manual: true,
        started_at: startDate.toISOString(),
        ended_at: endDate.toISOString(),
        description,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST .../timesheet/manual] insert error:", error);
      return NextResponse.json({ error: "Failed to log time" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
