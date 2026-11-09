// /api/operational/reportei/client-dashboards/:id
//   GET    → the dashboard with its client (view_tasks)
//   PATCH  { title?, doc?, period?, compare?, realtime? } → edit it; a new `period`
//          asks the data source again for every indicator (edit_boards)
//   DELETE → remove it (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseDoc, type ReportDoc } from "@/lib/reportei/doc";
import { comparisonOf, parsePeriod, refreshDashboardDoc } from "@/lib/reportei/dashboard-doc";
import { refreshRealDoc } from "@/lib/reportei/meta-doc";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase
      .from("reportei_dashboards")
      .select("id, client_id, title, doc, period, compare, realtime, updated_at, ops_clients(name, code)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[GET reportei/client-dashboards/:id]", error.message);
      return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const client = Array.isArray(data.ops_clients) ? data.ops_clients[0] : data.ops_clients;
    const logo = await ctx.supabase.from("reportei_client_logos").select("logo_url").eq("client_id", data.client_id).eq("account_id", ctx.accountId).maybeSingle();
    return NextResponse.json({
      dashboard: {
        id: data.id,
        clientId: data.client_id,
        clientName: client?.name ?? "",
        logoUrl: (logo.data?.logo_url as string | undefined) ?? null,
        title: data.title,
        doc: data.doc,
        period: data.period,
        compare: data.compare,
        realtime: data.realtime,
        updatedAt: data.updated_at,
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
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { title?: unknown; doc?: unknown; period?: unknown; compare?: unknown; realtime?: unknown } | null;
    const patch: Record<string, unknown> = {};

    if (body?.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200) return NextResponse.json({ error: "Invalid title" }, { status: 400 });
      patch.title = body.title.trim();
    }
    if (body?.compare !== undefined) {
      if (typeof body.compare !== "boolean") return NextResponse.json({ error: "Invalid compare" }, { status: 400 });
      patch.compare = body.compare;
    }
    if (body?.realtime !== undefined) {
      if (typeof body.realtime !== "boolean") return NextResponse.json({ error: "Invalid realtime" }, { status: 400 });
      patch.realtime = body.realtime;
    }

    let warnings: string[] = [];
    let doc: ReportDoc | null | undefined = body?.doc !== undefined ? parseDoc(body.doc) : undefined;
    if (doc === null) return NextResponse.json({ error: "Invalid doc" }, { status: 400 });
    if (body?.period !== undefined) {
      const period = parsePeriod(body.period);
      if (!period) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
      patch.period = period;
      const current = await ctx.supabase.from("reportei_dashboards").select("doc, client_id, compare").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
      if (current.error) return NextResponse.json({ error: "Failed to update dashboard" }, { status: 500 });
      if (!current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (doc === undefined) doc = parseDoc(current.data.doc);
      if (doc?.demo) {
        // A marked model keeps its made-up numbers (the preview), for the new period too.
        doc = refreshDashboardDoc(doc, period, `${id}:${period.since}:${period.until}`);
      } else if (doc) {
        // Real numbers: the linked Meta accounts are read again for the new period and only the numbers
        // inside the indicators change (order, titles, analyses and edits stay). If nothing can be read
        // the document is left as it was.
        const compared = typeof patch.compare === "boolean" ? patch.compare : current.data.compare !== false;
        const accounts = await collectAccountSnapshots(ctx, current.data.client_id as string, { since: period.since, until: period.until, compare: compared ? comparisonOf(period) : null, daily: true });
        if (accounts.length > 0 && accounts.every((a) => !a.insights)) return NextResponse.json({ error: "unreadable" }, { status: 502 });
        const refreshed = refreshRealDoc(doc, accounts, period);
        doc = refreshed.doc;
        warnings = refreshed.unreadable;
      }
    }
    if (doc) {
      patch.doc = doc;
      patch.networks = [...new Set(doc.blocks.map((b) => b.network).filter((n): n is string => !!n))];
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const { data, error } = await ctx.supabase.from("reportei_dashboards").update(patch).eq("id", id).eq("account_id", ctx.accountId).select("id").maybeSingle();
    if (error) {
      console.error("[PATCH reportei/client-dashboards/:id]", error.message);
      return NextResponse.json({ error: "Failed to update dashboard" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // A new period changes the numbers: hand the refreshed document back.
    return NextResponse.json({ ok: true, doc: body?.period !== undefined ? (patch.doc ?? null) : null, unreadable: warnings });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await ctx.supabase.from("reportei_dashboards").delete().eq("id", id).eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE reportei/client-dashboards/:id]", error.message);
      return NextResponse.json({ error: "Failed to delete dashboard" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
