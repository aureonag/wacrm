// /api/operational/reportei/reports
//   GET  ?clientId=&q=  → saved reports, newest first (view_tasks)
//   POST { clientId, period: preset | { since, until }, compare: boolean, title? }
//        → reads Meta now and saves the numbers as a report (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";
import { isValidRange, previousRange } from "@/lib/reportei/report";
import { createSavedReport } from "@/lib/reportei/report-create";
import { isUuid, loadTemplate } from "@/lib/reportei/template-store";
import { optionsOf } from "@/lib/reportei/template";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });

    let q = ctx.supabase
      .from("reportei_reports")
      .select("id, client_id, title, period_start, period_end, compare_start, auto, created_at, ops_clients(name, code)")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (clientId) q = q.eq("client_id", clientId);
    const { data, error } = await q;
    if (error) {
      console.error("[GET reportei/reports]", error.message);
      return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
    }
    const reports = (data ?? []).map((r) => {
      const client = Array.isArray(r.ops_clients) ? r.ops_clients[0] : r.ops_clients;
      return {
        id: r.id,
        clientId: r.client_id,
        clientName: client?.name ?? "",
        clientCode: client?.code ?? null,
        title: r.title,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        compared: r.compare_start !== null,
        auto: r.auto === true,
        createdAt: r.created_at,
      };
    });
    return NextResponse.json({ reports });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const body = (await req.json().catch(() => null)) as {
      clientId?: unknown;
      period?: unknown;
      compare?: unknown;
      title?: unknown;
      templateId?: unknown;
    } | null;

    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    if (!UUID.test(clientId)) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });

    const today = resolvePeriod("last_7d").until;
    let range: { since: string; until: string };
    if (isPeriod(body?.period)) {
      range = resolvePeriod(body.period);
    } else if (
      typeof body?.period === "object" &&
      body.period !== null &&
      isValidRange((body.period as Record<string, unknown>).since, (body.period as Record<string, unknown>).until, today)
    ) {
      const p = body.period as { since: string; until: string };
      range = { since: p.since, until: p.until };
    } else {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    const compare = body?.compare === true ? previousRange(range.since, range.until) : null;

    const client = await ctx.supabase
      .from("ops_clients")
      .select("id, name")
      .eq("id", clientId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (client.error) {
      console.error("[POST reportei/reports] client", client.error.message);
      return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The template only decides what the report shows; period and comparison come from the dialog.
    let options;
    if (body?.templateId !== undefined && body.templateId !== null) {
      if (!isUuid(body.templateId)) return NextResponse.json({ error: "Invalid templateId" }, { status: 400 });
      const template = await loadTemplate(ctx.supabase, ctx.accountId, body.templateId);
      if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      options = optionsOf(template);
    }

    const title =
      typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : `Relatório ${client.data.name}`;
    const result = await createSavedReport(ctx.supabase, {
      accountId: ctx.accountId,
      clientId,
      title,
      range,
      compare,
      createdBy: ctx.userId,
      options,
    });
    if (!result.ok) {
      if (result.reason === "no_integrations") return NextResponse.json({ error: "No integrations" }, { status: 422 });
      if (result.reason === "unreadable") return NextResponse.json({ error: "No account could be read" }, { status: 502 });
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
    }
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
