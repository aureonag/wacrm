// /api/operational/reportei/clients/:id/segment
//   GET → { segment, leadEvent, purchaseEvent, available }                       (view_tasks)
//   PUT { segment?, leadEvent?, purchaseEvent? } → saves what is sent            (edit_boards)
//        a field left out is kept; null puts it back to "not configured" / the canonical event
//
// What the client sells decides which results judge it in the general dashboard, and the
// events say which Meta event counts its leads and its purchases. Both are chosen by a
// person: nothing is inferred from the name or from an event that happened to show up. They
// live in reportei_client_settings (migration 180); before it is applied GET says
// "available: false" and PUT answers 503 { error: "migration_pending" }.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseEventType } from "@/lib/reportei/event-config";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const SEGMENTS = ["leads", "ecommerce", "mixed"] as const;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase.from("reportei_client_settings").select("segment, lead_event, purchase_event").eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (error) return NextResponse.json({ segment: null, leadEvent: null, purchaseEvent: null, available: false });
    const segment = typeof data?.segment === "string" && (SEGMENTS as readonly string[]).includes(data.segment) ? data.segment : null;
    return NextResponse.json({ segment, leadEvent: (data?.lead_event as string | null) ?? null, purchaseEvent: (data?.purchase_event as string | null) ?? null, available: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { segment?: unknown; leadEvent?: unknown; purchaseEvent?: unknown } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.segment !== undefined) {
      if (body.segment !== null && !(typeof body.segment === "string" && (SEGMENTS as readonly string[]).includes(body.segment))) return NextResponse.json({ error: "Invalid segment" }, { status: 400 });
      patch.segment = body.segment;
    }
    if (body.leadEvent !== undefined) {
      const v = parseEventType(body.leadEvent);
      if (v === undefined) return NextResponse.json({ error: "Invalid leadEvent" }, { status: 400 });
      patch.lead_event = v;
    }
    if (body.purchaseEvent !== undefined) {
      const v = parseEventType(body.purchaseEvent);
      if (v === undefined) return NextResponse.json({ error: "Invalid purchaseEvent" }, { status: 400 });
      patch.purchase_event = v;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error } = await ctx.supabase.from("reportei_client_settings").upsert({ client_id: id, account_id: ctx.accountId, ...patch }, { onConflict: "client_id" });
    if (error) {
      // 42703: a column does not exist yet (migration 180 not applied).
      if (error.code === "42703" || /segment|lead_event|purchase_event/.test(error.message)) return NextResponse.json({ error: "migration_pending" }, { status: 503 });
      console.error("[PUT reportei/clients/:id/segment]", error.message);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
