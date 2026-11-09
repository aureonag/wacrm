// /api/operational/reportei/templates
//   GET  → the account's report templates (view_tasks)
//   POST { name, description?, layout } → save a report layout as a template (edit_boards);
//        the older form { name, metrics, chart, chartMetrics, compare, intro } still works

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseLayout } from "@/lib/reportei/doc-templates";
import { DEFAULT_OPTIONS, parseName, parseOptions, templateFromRow, type TemplateListItem } from "@/lib/reportei/template";
import { TEMPLATE_COLUMNS } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { data, error } = await ctx.supabase
      .from("reportei_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[GET reportei/templates]", error.message);
      return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
    }
    // The experts' names and photos come from their profile, so they stay current.
    const templates = (data ?? []).map(templateFromRow);
    const ownerIds = [...new Set(templates.map((t) => t.ownerProfileId).filter((id): id is string => !!id))];
    const owners = new Map<string, { name: string; avatar: string | null }>();
    if (ownerIds.length > 0) {
      const people = await ctx.supabase.from("profiles").select("id, full_name, avatar_url").eq("account_id", ctx.accountId).in("id", ownerIds);
      for (const p of people.data ?? []) owners.set(p.id as string, { name: (p.full_name as string) ?? "", avatar: (p.avatar_url as string | null) ?? null });
    }
    const items: TemplateListItem[] = templates.map((t) => ({ ...t, ownerName: owners.get(t.ownerProfileId ?? "")?.name ?? null, ownerAvatarUrl: owners.get(t.ownerProfileId ?? "")?.avatar ?? null }));
    return NextResponse.json({ templates: items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = parseName(body?.name);
    const layout = body?.layout !== undefined ? parseLayout(body.layout) : undefined;
    if (layout === null) return NextResponse.json({ error: "Invalid layout" }, { status: 400 });
    const options = layout ? DEFAULT_OPTIONS : parseOptions(body);
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
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
        description: description || null,
        layout: layout ?? null,
        kind: "mine",
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
