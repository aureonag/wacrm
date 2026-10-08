// POST /api/operational/timesheet/start — begin tracking time on a task.
//      Requires operational:timesheet:track. Enforced account-wide "one
//      active timer per user" at the DB level (partial unique index) —
//      this route also checks first so it can return a helpful 409
//      pointing at whichever task is already running, instead of a bare
//      constraint-violation 500.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("operational", "timesheet", "track");

    const limit = checkRateLimit(`operational:timesheetStart:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { task_id?: unknown; switch?: unknown } | null;
    const taskId = typeof body?.task_id === "string" ? body.task_id : "";
    // `switch: true` (Kanban card): if a timer is running on another task,
    // close it (its time stays saved) and start this one.
    const switchTask = body?.switch === true;
    if (!taskId) return NextResponse.json({ error: "'task_id' is required" }, { status: 400 });

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const { data: active } = await ctx.supabase
      .from("timesheet_entries")
      .select("id, task_id, task:tasks(id, title, board_id)")
      .eq("user_id", ctx.userId)
      .is("ended_at", null)
      .maybeSingle();
    let pausedTitle: string | null = null;
    if (active) {
      if (!switchTask) {
        return NextResponse.json(
          { error: "A timer is already running", active_entry: active },
          { status: 409 },
        );
      }
      // Already running on this very task: nothing to do.
      if (active.task_id === taskId) return NextResponse.json({ id: active.id, already_running: true });

      const { error: stopError } = await ctx.supabase
        .from("timesheet_entries")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", active.id);
      if (stopError) {
        console.error("[POST .../timesheet/start] could not pause the running timer:", stopError);
        return NextResponse.json({ error: "Failed to pause the running timer" }, { status: 500 });
      }
      const other = (Array.isArray(active.task) ? active.task[0] : active.task) as { title?: string } | null;
      pausedTitle = other?.title ?? null;
    }

    const { data, error } = await ctx.supabase
      .from("timesheet_entries")
      .insert({ account_id: ctx.accountId, task_id: taskId, user_id: ctx.userId, is_manual: false })
      .select("id")
      .single();

    if (error) {
      console.error("[POST .../timesheet/start] insert error:", error);
      return NextResponse.json({ error: "Failed to start timer" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, paused_task_title: pausedTitle }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
