// /api/operational/reportei/templates
//   GET  → the account's report templates (view_tasks)
//   POST { name, metrics, chart, chartMetrics, compare, intro } → create one (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseName, parseOptions, templateFromRow } from "@/lib/reportei/template";
import { TEMPLATE_COLUMNS } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { data, error } = await ctx.supabase
      .from("reportei_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("account_id", ctx.accountId)
      .order("name", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[GET reportei/templates]", error.message);
      return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
    }
    return NextResponse.json({ templates: (data ?? []).map(templateFromRow) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = parseName(body?.name);
    const options = parseOptions(body);
    if (!name || !options) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("reportei_templates")
      .insert({
        account_id: ctx.accountId,
        name,
        metrics: options.metrics,
        chart: options.chart,
        chart_metrics: options.chartMetrics,
        compare: body?.compare !== false,
        intro: options.intro || null,
        created_by: ctx.userId,
      })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error || !data) {
      console.error("[POST reportei/templates]", error?.message);
      return NextResponse.json({ error: "Failed to save template" }, { status: 500 });
    }
    return NextResponse.json({ template: templateFromRow(data) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
