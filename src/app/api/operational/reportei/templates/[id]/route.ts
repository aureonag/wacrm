// /api/operational/reportei/templates/:id
//   PUT    { name, metrics, chart, chartMetrics, compare, intro } → change it (edit_boards)
//   DELETE → remove it; reports already generated keep their own copy of the choices,
//            and automations that used it go back to the default (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseName, parseOptions, templateFromRow } from "@/lib/reportei/template";
import { TEMPLATE_COLUMNS, isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = parseName(body?.name);
    const options = parseOptions(body);
    if (!name || !options) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("reportei_templates")
      .update({
        name,
        metrics: options.metrics,
        chart: options.chart,
        chart_metrics: options.chartMetrics,
        compare: body?.compare !== false,
        intro: options.intro || null,
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select(TEMPLATE_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error("[PUT reportei/templates]", error.message);
      return NextResponse.json({ error: "Failed to save template" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ template: templateFromRow(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await ctx.supabase.from("reportei_templates").delete().eq("id", id).eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE reportei/templates]", error.message);
      return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
