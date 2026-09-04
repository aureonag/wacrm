// POST /api/operational/timesheet/stop — close the caller's currently
//      running timer (wherever it is). "Pausar"/"Finalizar" in the UI
//      both call this — the difference is purely presentational; the
//      task-drawer distinguishes them by whether the entry is for the
//      task currently open. Requires operational:timesheet:track.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST() {
  try {
    const ctx = await requirePermission("operational", "timesheet", "track");

    const limit = checkRateLimit(`operational:timesheetStop:${ctx.userId}`, RATE_LIMITS.taskWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: active } = await ctx.supabase
      .from("timesheet_entries")
      .select("id")
      .eq("user_id", ctx.userId)
      .is("ended_at", null)
      .maybeSingle();
    if (!active) return NextResponse.json({ error: "No timer is running" }, { status: 404 });

    const { error } = await ctx.supabase
      .from("timesheet_entries")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", active.id);

    if (error) {
      console.error("[POST .../timesheet/stop] update error:", error);
      return NextResponse.json({ error: "Failed to stop timer" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
