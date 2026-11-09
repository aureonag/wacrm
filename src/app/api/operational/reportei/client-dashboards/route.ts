// /api/operational/reportei/client-dashboards
//   GET  ?clientId= → the dashboards of a client (view_tasks)
//   POST { clientId, integrations: [{network, account}] } → makes one with the Padrão
//        layout for those integrations (edit_boards). Numbers come from the demo source
//        until each network is connected.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { CATALOG_NETWORKS } from "@/lib/reportei/doc-catalog";
import { buildDashboardDoc, comparisonOf, resolveDashboardPreset, type DashboardAccount } from "@/lib/reportei/dashboard-doc";
import { makeId } from "@/lib/reportei/doc";
import { DASHBOARD_LAYOUT } from "@/lib/reportei/doc-templates";
import { buildRealDoc } from "@/lib/reportei/meta-doc";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";
import { resolvePeriod } from "@/lib/reportei/periods";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
    if (!isUuid(clientId)) return NextResponse.json({ error: "Invalid client" }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("reportei_dashboards")
      .select("id, title, networks, updated_at, created_at")
      .eq("client_id", clientId)
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[GET reportei/client-dashboards]", error.message);
      return NextResponse.json({ error: "Failed to load dashboards" }, { status: 500 });
    }
    return NextResponse.json({ dashboards: (data ?? []).map((d) => ({ id: d.id, title: d.title, networks: d.networks ?? [], updatedAt: d.updated_at })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const body = (await req.json().catch(() => null)) as { clientId?: unknown; integrations?: unknown; demo?: unknown } | null;
    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    if (!isUuid(clientId)) return NextResponse.json({ error: "Invalid client" }, { status: 400 });
    const demo = body?.demo === true;
    const raw = Array.isArray(body?.integrations) ? body.integrations : [];
    const accounts: DashboardAccount[] = raw
      .filter((i): i is { network: string; account: string } => !!i && typeof i.network === "string" && typeof i.account === "string" && (CATALOG_NETWORKS as readonly string[]).includes(i.network) && i.account.length > 0 && i.account.length <= 200)
      .slice(0, 20);
    if (demo && accounts.length === 0) return NextResponse.json({ error: "Choose at least one integration" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id, name").eq("id", clientId).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const today = resolvePeriod("last_7d").until;
    const range = resolveDashboardPreset("last_30d", today);
    let doc;
    if (demo) {
      // The marked preview: made-up numbers, flagged in the document.
      doc = buildDashboardDoc(accounts, range, `${clientId}:${Date.now()}`);
      doc.demo = true;
    } else {
      // Real: every Meta Ads account linked to the client, read now. Nothing is made up.
      const snapshots = await collectAccountSnapshots(ctx, clientId, { since: range.since, until: range.until, compare: comparisonOf(range), daily: true });
      if (snapshots.length === 0) return NextResponse.json({ error: "no_integration" }, { status: 422 });
      const built = buildRealDoc({ layout: DASHBOARD_LAYOUT, accounts: snapshots, range, newId: makeId, hideCover: true });
      if (built.doc.blocks.length === 0) return NextResponse.json({ error: snapshots.every((a) => !a.insights) ? "unreadable" : "nothing_to_show" }, { status: snapshots.every((a) => !a.insights) ? 502 : 422 });
      doc = built.doc;
    }
    if (doc.blocks.length === 0) return NextResponse.json({ error: "Nothing to show" }, { status: 422 });

    const { data, error } = await ctx.supabase
      .from("reportei_dashboards")
      .insert({
        account_id: ctx.accountId,
        client_id: clientId,
        title: `Dashboard de ${client.data.name}`.slice(0, 200),
        doc,
        period: { preset: "last_30d", ...range },
        networks: [...new Set(doc.blocks.map((b) => b.network).filter((n): n is string => !!n))],
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[POST reportei/client-dashboards]", error.message);
      return NextResponse.json({ error: "Failed to create dashboard" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
