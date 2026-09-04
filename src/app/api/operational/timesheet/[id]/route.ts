// PATCH  /api/operational/timesheet/[id] — edit a logged entry (times,
//        description). Editing your own entry requires
//        operational:timesheet:track; editing anyone else's requires
//        operational:timesheet:edit_entries (the "ajustar horas" admin
//        action).
// DELETE /api/operational/timesheet/[id] — same permission split.

import { NextResponse } from "next/server";
import { type AccountContext, ForbiddenError, getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

async function requireEntryAccess(ctx: AccountContext, entryUserId: string | null) {
  const isOwn = entryUserId === ctx.userId;
  const action = isOwn ? "track" : "edit_entries";
  const { data: allowed, error } = await ctx.supabase.rpc("has_permission", {
    p_environment: "operational",
    p_module: "timesheet",
    p_action: action,
  });
  if (error) throw new ForbiddenError("Could not verify permission");
  if (!allowed) throw new ForbiddenError(`Missing permission: operational:timesheet:${action}`);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const { data: existing } = await ctx.supabase
      .from("timesheet_entries")
      .select("id, user_id, started_at, ended_at")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    await requireEntryAccess(ctx, existing.user_id);
    const limit = checkRateLimit(`operational:timesheetEdit:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { started_at?: unknown; ended_at?: unknown; description?: unknown }
      | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const update: Record<string, unknown> = {};
    const startedAt = typeof body.started_at === "string" ? body.started_at : existing.started_at;
    const endedAt = typeof body.ended_at === "string" ? body.ended_at : existing.ended_at;
    if (typeof body.started_at === "string" || typeof body.ended_at === "string") {
      const startDate = new Date(startedAt);
      const endDate = endedAt ? new Date(endedAt) : null;
      if (Number.isNaN(startDate.getTime()) || (endDate && Number.isNaN(endDate.getTime()))) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      if (endDate && endDate <= startDate) {
        return NextResponse.json({ error: "'ended_at' must be after 'started_at'" }, { status: 400 });
      }
      if (typeof body.started_at === "string") update.started_at = startDate.toISOString();
      if (typeof body.ended_at === "string") update.ended_at = endDate!.toISOString();
    }
    if (typeof body.description === "string") update.description = body.description.trim() || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No recognized fields to update" }, { status: 400 });
    }

    const { error } = await ctx.supabase.from("timesheet_entries").update(update).eq("id", id);
    if (error) {
      console.error("[PATCH .../timesheet/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const { data: existing } = await ctx.supabase
      .from("timesheet_entries")
      .select("id, user_id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    await requireEntryAccess(ctx, existing.user_id);
    const limit = checkRateLimit(`operational:timesheetDelete:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase.from("timesheet_entries").delete().eq("id", id);
    if (error) {
      console.error("[DELETE .../timesheet/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
