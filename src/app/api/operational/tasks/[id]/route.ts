// PATCH  /api/operational/tasks/[id] — edit fields and/or move between
//        stages. Field edits require operational:tasks:edit_tasks;
//        changing stage_id/position alone also accepts
//        operational:tasks:move_tasks (drag-and-drop shouldn't require
//        full edit rights).
// DELETE /api/operational/tasks/[id] — delete a task. Requires
//        operational:tasks:delete_tasks.

import { NextResponse } from "next/server";
import { ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { TaskPriority, TaskStatus } from "@/types";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
const STATUSES: TaskStatus[] = ["open", "done"];
const MOVE_ONLY_FIELDS = new Set(["stage_id", "position"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const isMoveOnly = Object.keys(body).every((k) => MOVE_ONLY_FIELDS.has(k));
    const ctx = isMoveOnly
      ? await (async () => {
          try {
            return await requirePermission("operational", "tasks", "move_tasks");
          } catch (err) {
            if (err instanceof ForbiddenError) {
              return requirePermission("operational", "tasks", "edit_tasks");
            }
            throw err;
          }
        })()
      : await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:taskEdit:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: existing } = await ctx.supabase
      .from("tasks")
      .select("id, board_id, stage_id, drive_folder_url")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const update: Record<string, unknown> = {};
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return NextResponse.json({ error: "'title' cannot be empty" }, { status: 400 });
      update.title = title;
    }
    // Moving to another board (the 3-dot menu's "Mover para outro quadro")
    // sends board_id + stage_id together — stage_id alone (drag-and-drop
    // within the same board) validates against the task's current board.
    const targetBoardId = typeof body.board_id === "string" ? body.board_id : existing.board_id;
    if (typeof body.board_id === "string") {
      const { data: board } = await ctx.supabase
        .from("boards")
        .select("id")
        .eq("id", body.board_id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
      update.board_id = body.board_id;
    }
    if (typeof body.stage_id === "string") {
      const { data: stage } = await ctx.supabase
        .from("board_stages")
        .select("id, requires_file, requires_checklist_complete, requires_approval")
        .eq("id", body.stage_id)
        .eq("board_id", targetBoardId)
        .maybeSingle();
      if (!stage) return NextResponse.json({ error: "Stage not found on this board" }, { status: 400 });

      if (stage.id !== existing.stage_id) {
        const unmet: string[] = [];
        const effectiveDriveFolderUrl =
          typeof body.drive_folder_url === "string" || body.drive_folder_url === null
            ? body.drive_folder_url
            : existing.drive_folder_url;
        if (stage.requires_file && !effectiveDriveFolderUrl) {
          unmet.push("file");
        }
        if (stage.requires_checklist_complete) {
          const { data: items } = await ctx.supabase
            .from("task_checklist_items")
            .select("done")
            .eq("task_id", id);
          if (!items || items.length === 0 || items.some((it) => !it.done)) {
            unmet.push("checklist");
          }
        }
        if (stage.requires_approval) {
          const { data: latest } = await ctx.supabase
            .from("task_approvals")
            .select("status")
            .eq("task_id", id)
            .order("requested_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latest?.status !== "approved") {
            unmet.push("approval");
          }
        }
        if (unmet.length > 0) {
          return NextResponse.json(
            { error: "Stage requirements not met", unmet },
            { status: 400 },
          );
        }
      }

      update.stage_id = body.stage_id;
    } else if (typeof body.board_id === "string") {
      return NextResponse.json({ error: "'stage_id' is required when changing 'board_id'" }, { status: 400 });
    }
    if (typeof body.briefing === "object") {
      update.briefing = body.briefing;
    }
    if (typeof body.position === "number") update.position = body.position;
    if (typeof body.contact_id === "string" || body.contact_id === null) update.contact_id = body.contact_id;
    if (typeof body.sector_id === "string" || body.sector_id === null) update.sector_id = body.sector_id;
    if (typeof body.assignee_id === "string" || body.assignee_id === null) update.assignee_id = body.assignee_id;
    if (typeof body.priority === "string" && PRIORITIES.includes(body.priority as TaskPriority)) {
      update.priority = body.priority;
    }
    if (typeof body.is_urgent === "boolean") update.is_urgent = body.is_urgent;
    if (typeof body.start_date === "string" || body.start_date === null) update.start_date = body.start_date;
    if (typeof body.due_date === "string" || body.due_date === null) update.due_date = body.due_date;
    if (typeof body.estimated_minutes === "number" || body.estimated_minutes === null) {
      update.estimated_minutes = body.estimated_minutes;
    }
    if (typeof body.status === "string" && STATUSES.includes(body.status as TaskStatus)) {
      update.status = body.status;
    }
    if (typeof body.parent_task_id === "string" || body.parent_task_id === null) {
      update.parent_task_id = body.parent_task_id;
    }
    if (typeof body.drive_folder_url === "string" || body.drive_folder_url === null) {
      const url = typeof body.drive_folder_url === "string" ? body.drive_folder_url.trim() : "";
      if (!url) {
        update.drive_folder_url = null;
      } else {
        try {
          new URL(url);
        } catch {
          return NextResponse.json({ error: "'drive_folder_url' must be a valid URL" }, { status: 400 });
        }
        update.drive_folder_url = url;
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No recognized fields to update" }, { status: 400 });
    }

    const { error } = await ctx.supabase.from("tasks").update(update).eq("id", id);
    if (error) {
      console.error("[PATCH /api/operational/tasks/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission("operational", "tasks", "delete_tasks");

    const limit = checkRateLimit(`operational:taskDelete:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/operational/tasks/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
