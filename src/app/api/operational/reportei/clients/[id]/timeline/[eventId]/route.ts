// /api/operational/reportei/clients/:id/timeline/:eventId
//   PUT    { date, title, description? } → change a milestone (edit_boards)
//   DELETE → remove it (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isUuid } from "@/lib/reportei/template-store";
import { eventFromRow, parseTimelineInput } from "@/lib/reportei/timeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eventId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id, eventId } = await params;
    if (!isUuid(id) || !isUuid(eventId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseTimelineInput(await req.json().catch(() => null));
    if (!input) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("reportei_timeline_events")
      .update({ event_date: input.date, title: input.title, description: input.description || null })
      .eq("id", eventId)
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .select("id, event_date, title, description")
      .maybeSingle();
    if (error) {
      console.error("[PUT reportei timeline]", error.message);
      return NextResponse.json({ error: "Failed to save milestone" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ event: eventFromRow(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id, eventId } = await params;
    if (!isUuid(id) || !isUuid(eventId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await ctx.supabase.from("reportei_timeline_events").delete().eq("id", eventId).eq("client_id", id).eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE reportei timeline]", error.message);
      return NextResponse.json({ error: "Failed to delete milestone" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
