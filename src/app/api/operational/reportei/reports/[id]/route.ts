// /api/operational/reportei/reports/:id
//   GET    → the saved report with its frozen numbers (view_tasks)
//   PATCH  { title?, notes? } → edit the text around the numbers (edit_boards)
//   DELETE → remove it (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .select("id, client_id, title, notes, snapshot, created_at, ops_clients(name, code)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[GET reportei/reports/:id]", error.message);
      return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const client = Array.isArray(data.ops_clients) ? data.ops_clients[0] : data.ops_clients;
    return NextResponse.json({
      report: {
        id: data.id,
        clientId: data.client_id,
        clientName: client?.name ?? "",
        clientCode: client?.code ?? null,
        title: data.title,
        notes: data.notes ?? "",
        snapshot: data.snapshot,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { title?: unknown; notes?: unknown } | null;
    const patch: { title?: string; notes?: string | null } = {};
    if (body?.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200) {
        return NextResponse.json({ error: "Invalid title" }, { status: 400 });
      }
      patch.title = body.title.trim();
    }
    if (body?.notes !== undefined) {
      if (typeof body.notes !== "string" || body.notes.length > 5000) return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
      patch.notes = body.notes.trim() || null;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .update(patch)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[PATCH reportei/reports/:id]", error.message);
      return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await ctx.supabase.from("reportei_reports").delete().eq("id", id).eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE reportei/reports/:id]", error.message);
      return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
