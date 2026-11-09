// POST /api/operational/reportei/reports/:id/duplicate — a copy of the report (its
// numbers, document and notes), named "… (cópia)", not shared. edit_boards.

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

    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .select("client_id, title, subtitle, notes, period_start, period_end, compare_start, compare_end, snapshot, networks")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[POST reportei/reports/:id/duplicate] read", error.message);
      return NextResponse.json({ error: "Failed to duplicate" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const copy = await ctx.supabase
      .from("reportei_reports")
      .insert({ ...data, account_id: ctx.accountId, title: `${data.title} (cópia)`.slice(0, 200), created_by: ctx.userId, auto: false })
      .select("id")
      .single();
    if (copy.error || !copy.data) {
      console.error("[POST reportei/reports/:id/duplicate] insert", copy.error?.message);
      return NextResponse.json({ error: "Failed to duplicate" }, { status: 500 });
    }
    return NextResponse.json({ id: copy.data.id as string }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
