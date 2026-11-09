// POST /api/operational/reportei/client-dashboards/:id/duplicate → a copy named "<title> (cópia)" (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const src = await ctx.supabase.from("reportei_dashboards").select("client_id, title, doc, period, compare, realtime, networks").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (src.error) return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
    if (!src.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase
      .from("reportei_dashboards")
      .insert({ ...src.data, title: `${src.data.title} (cópia)`.slice(0, 200), account_id: ctx.accountId, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) {
      console.error("[POST reportei/client-dashboards/:id/duplicate]", error.message);
      return NextResponse.json({ error: "Failed to duplicate dashboard" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
