// /api/operational/reportei/reports/:id/share
//   POST   → turn the public read-only link on (idempotent: keeps the current token)
//   DELETE → revoke it; the old link stops working at once

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: current, error: readError } = await ctx.supabase
      .from("reportei_reports")
      .select("share_token")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (readError) {
      console.error("[POST reportei/reports/:id/share]", readError.message);
      return NextResponse.json({ error: "Failed to share report" }, { status: 500 });
    }
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (current.share_token) return NextResponse.json({ token: current.share_token });

    const token = randomBytes(32).toString("base64url");
    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .is("share_token", null)
      .select("share_token")
      .maybeSingle();
    if (error) {
      console.error("[POST reportei/reports/:id/share]", error.message);
      return NextResponse.json({ error: "Failed to share report" }, { status: 500 });
    }
    // Lost a race with another click: return whichever token won.
    if (!data) {
      const { data: again } = await ctx.supabase.from("reportei_reports").select("share_token").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
      if (!again?.share_token) return NextResponse.json({ error: "Failed to share report" }, { status: 500 });
      return NextResponse.json({ token: again.share_token });
    }
    return NextResponse.json({ token: data.share_token }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await ctx.supabase
      .from("reportei_reports")
      .update({ share_token: null, shared_at: null })
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE reportei/reports/:id/share]", error.message);
      return NextResponse.json({ error: "Failed to revoke link" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
