// /api/operational/reportei/reports
//   GET  ?clientId=&q=  → saved reports, newest first (view_tasks)
//   POST { clientId, period: preset | { since, until }, compare: boolean, title? }
//        → reads Meta now and saves the numbers as a report (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";
import { isValidRange, previousRange, type ReportSnapshot } from "@/lib/reportei/report";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });

    let q = ctx.supabase
      .from("reportei_reports")
      .select("id, client_id, title, period_start, period_end, compare_start, created_at, ops_clients(name, code)")
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

    const accounts = await collectAccountSnapshots(ctx, clientId, { ...range, compare, daily: true }).catch((err: unknown) => {
      console.error("[POST reportei/reports] collect", err instanceof Error ? err.message : err);
      return null;
    });
    if (!accounts) return NextResponse.json({ error: "Failed to read integrations" }, { status: 500 });
    if (accounts.length === 0) return NextResponse.json({ error: "No integrations" }, { status: 422 });
    if (accounts.every((a) => a.error)) return NextResponse.json({ error: "No account could be read", accounts }, { status: 502 });

    const snapshot: ReportSnapshot = { period: range, compare, accounts };
    const title =
      typeof body?.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : `Relatório ${client.data.name}`;

    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .insert({
        account_id: ctx.accountId,
        client_id: clientId,
        title,
        period_start: range.since,
        period_end: range.until,
        compare_start: compare?.since ?? null,
        compare_end: compare?.until ?? null,
        snapshot,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[POST reportei/reports] insert", error?.message);
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
