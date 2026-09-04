// POST /api/operational/tasks — create a task (or a subtask, when
//      `parent_task_id` is set). Requires operational:tasks:create_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { TaskPriority } from "@/types";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "create_tasks");

    const limit = checkRateLimit(`operational:taskCreate:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          board_id?: unknown;
          stage_id?: unknown;
          title?: unknown;
          parent_task_id?: unknown;
          contact_id?: unknown;
          sector_id?: unknown;
          assignee_id?: unknown;
          priority?: unknown;
          is_urgent?: unknown;
          start_date?: unknown;
          due_date?: unknown;
          estimated_minutes?: unknown;
        }
      | null;

    const boardId = typeof body?.board_id === "string" ? body.board_id : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!boardId || !title) {
      return NextResponse.json({ error: "'board_id' and 'title' are required" }, { status: 400 });
    }

    const { data: board } = await ctx.supabase
      .from("boards")
      .select("id")
      .eq("id", boardId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    let stageId = typeof body?.stage_id === "string" ? body.stage_id : "";
    if (!stageId) {
      const { data: firstStage } = await ctx.supabase
        .from("board_stages")
        .select("id")
        .eq("board_id", boardId)
        .order("position")
        .limit(1)
        .maybeSingle();
      if (!firstStage) {
        return NextResponse.json({ error: "Board has no stages yet" }, { status: 409 });
      }
      stageId = firstStage.id;
    }

    const priority =
      typeof body?.priority === "string" && PRIORITIES.includes(body.priority as TaskPriority)
        ? (body.priority as TaskPriority)
        : "medium";

    const { count } = await ctx.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        account_id: ctx.accountId,
        board_id: boardId,
        stage_id: stageId,
        title,
        parent_task_id: typeof body?.parent_task_id === "string" ? body.parent_task_id : null,
        contact_id: typeof body?.contact_id === "string" ? body.contact_id : null,
        sector_id: typeof body?.sector_id === "string" ? body.sector_id : null,
        assignee_id: typeof body?.assignee_id === "string" ? body.assignee_id : null,
        priority,
        is_urgent: body?.is_urgent === true,
        start_date: typeof body?.start_date === "string" ? body.start_date : null,
        due_date: typeof body?.due_date === "string" ? body.due_date : null,
        estimated_minutes: typeof body?.estimated_minutes === "number" ? body.estimated_minutes : null,
        created_by: ctx.userId,
        position: count ?? 0,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST /api/operational/tasks] insert error:", error);
      return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
