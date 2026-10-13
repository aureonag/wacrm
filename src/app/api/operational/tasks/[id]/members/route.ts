// PUT /api/operational/tasks/[id]/members — set the people on a task ("Membros").
// The first id is the main person (tasks.assignee_id), the rest are participants
// (task_participants). Replaces the whole list. Requires operational:tasks:edit_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { splitMembers } from "@/lib/tasks/members";

const MAX_MEMBERS = 30;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission("operational", "tasks", "edit_tasks");

    const limit = checkRateLimit(`operational:taskMembers:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { profile_ids?: unknown } | null;
    if (!Array.isArray(body?.profile_ids) || !body.profile_ids.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "'profile_ids' must be a list of ids" }, { status: 400 });
    }
    const ids = [...new Set(body.profile_ids as string[])];
    if (ids.length > MAX_MEMBERS) return NextResponse.json({ error: "Too many members" }, { status: 400 });

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    // Only people of this account.
    if (ids.length > 0) {
      const { data: found } = await ctx.supabase
        .from("profiles")
        .select("id")
        .eq("account_id", ctx.accountId)
        .in("id", ids);
      const valid = new Set((found ?? []).map((p) => p.id as string));
      if (ids.some((p) => !valid.has(p))) {
        return NextResponse.json({ error: "Member not found" }, { status: 400 });
      }
    }

    const { assigneeId, participantIds } = splitMembers(ids);

    const { error: updateError } = await ctx.supabase.from("tasks").update({ assignee_id: assigneeId }).eq("id", id);
    if (updateError) {
      console.error("[PUT tasks/[id]/members] assignee update error:", updateError);
      return NextResponse.json({ error: "Failed to update members" }, { status: 500 });
    }

    const { data: current } = await ctx.supabase.from("task_participants").select("profile_id").eq("task_id", id);
    const currentIds = new Set((current ?? []).map((r) => r.profile_id as string));
    const wanted = new Set(participantIds);

    const toRemove = [...currentIds].filter((p) => !wanted.has(p));
    const toAdd = participantIds.filter((p) => !currentIds.has(p));

    if (toRemove.length > 0) {
      const { error } = await ctx.supabase
        .from("task_participants")
        .delete()
        .eq("task_id", id)
        .in("profile_id", toRemove);
      if (error) console.error("[PUT tasks/[id]/members] participants delete error:", error);
    }
    if (toAdd.length > 0) {
      const { error } = await ctx.supabase
        .from("task_participants")
        .insert(toAdd.map((profile_id) => ({ task_id: id, profile_id })));
      if (error) console.error("[PUT tasks/[id]/members] participants insert error:", error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
