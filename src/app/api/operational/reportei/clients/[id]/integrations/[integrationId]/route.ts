// DELETE /api/operational/reportei/clients/:id/integrations/:integrationId —
// unlinks one ad account from the client. Needs edit_boards; RLS-scoped.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

const UUID = /^[0-9a-f-]{36}$/i;

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; integrationId: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id, integrationId } = await params;
    if (!UUID.test(id) || !UUID.test(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("ad_integrations")
      .delete()
      .eq("id", integrationId)
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .select("id");
    if (error) {
      console.error("[DELETE reportei/clients/:id/integrations/:integrationId]", error.message);
      return NextResponse.json({ error: "Failed to remove integration" }, { status: 500 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
