// /api/operational/reportei/reports/:id
//   GET    → the saved report with its frozen numbers (view_tasks)
//   PATCH  { title?, subtitle?, notes?, options?, doc? } → edit the text around the numbers, what
//          the report shows (metrics, chart, intro) and, for document reports, the whole document
//          (blocks and indicators, saved by the editor on its own) (edit_boards)
//   DELETE → remove it (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseDoc } from "@/lib/reportei/doc";
import type { ReportSnapshot } from "@/lib/reportei/report";
import { parseOptions } from "@/lib/reportei/template";

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
      .select("id, client_id, title, subtitle, notes, snapshot, share_token, share_expires_at, created_at, ops_clients(name, code)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[GET reportei/reports/:id]", error.message);
      return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const client = Array.isArray(data.ops_clients) ? data.ops_clients[0] : data.ops_clients;
    const logo = await ctx.supabase.from("reportei_client_logos").select("logo_url").eq("client_id", data.client_id).eq("account_id", ctx.accountId).maybeSingle();
    return NextResponse.json({
      report: {
        logoUrl: (logo.data?.logo_url as string | undefined) ?? null,
        id: data.id,
        clientId: data.client_id,
        clientName: client?.name ?? "",
        clientCode: client?.code ?? null,
        title: data.title,
        subtitle: data.subtitle ?? "",
        notes: data.notes ?? "",
        snapshot: data.snapshot,
        shareToken: data.share_token ?? null,
        shareExpiresAt: data.share_expires_at ?? null,
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

    const body = (await req.json().catch(() => null)) as { title?: unknown; subtitle?: unknown; notes?: unknown; options?: unknown; doc?: unknown } | null;
    const patch: { title?: string; subtitle?: string | null; notes?: string | null; snapshot?: ReportSnapshot; networks?: string[] } = {};
    if (body?.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200) {
        return NextResponse.json({ error: "Invalid title" }, { status: 400 });
      }
      patch.title = body.title.trim();
    }
    if (body?.subtitle !== undefined) {
      if (typeof body.subtitle !== "string" || body.subtitle.length > 300) return NextResponse.json({ error: "Invalid subtitle" }, { status: 400 });
      patch.subtitle = body.subtitle.trim() || null;
    }
    if (body?.options !== undefined || body?.doc !== undefined) {
      const options = body.options !== undefined ? parseOptions(body.options) : undefined;
      if (options === null) return NextResponse.json({ error: "Invalid options" }, { status: 400 });
      const doc = body.doc !== undefined ? parseDoc(body.doc) : undefined;
      if (doc === null) return NextResponse.json({ error: "Invalid doc" }, { status: 400 });
      // The numbers stay as they were saved; only what is shown changes.
      const current = await ctx.supabase.from("reportei_reports").select("snapshot").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
      if (current.error) {
        console.error("[PATCH reportei/reports/:id] snapshot", current.error.message);
        return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
      }
      if (!current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
      patch.snapshot = { ...(current.data.snapshot as ReportSnapshot), ...(options ? { options } : {}), ...(doc ? { doc } : {}) };
      // The icons of the list follow the networks of the blocks.
      if (doc) patch.networks = [...new Set(doc.blocks.map((b) => b.network).filter((n): n is string => !!n))];
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
