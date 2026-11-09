// /api/operational/reportei/clients/:id/timeline
//   GET  → { events: [{ id, date, title, description }] }, newest first (view_tasks)
//   POST { date, title, description? } → add a milestone (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isUuid } from "@/lib/reportei/template-store";
import { eventFromRow, parseTimelineInput } from "@/lib/reportei/timeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COLUMNS = "id, event_date, title, description";

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase
      .from("reportei_timeline_events")
      .select(COLUMNS)
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[GET reportei timeline]", error.message);
      return NextResponse.json({ error: "Failed to load timeline" }, { status: 500 });
    }
    return NextResponse.json({ events: (data ?? []).map(eventFromRow) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseTimelineInput(await req.json().catch(() => null));
    if (!input) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("reportei_timeline_events")
      .insert({ account_id: ctx.accountId, client_id: id, event_date: input.date, title: input.title, description: input.description || null, created_by: ctx.userId })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      console.error("[POST reportei timeline]", error?.message);
      return NextResponse.json({ error: "Failed to save milestone" }, { status: 500 });
    }
    return NextResponse.json({ event: eventFromRow(data) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
