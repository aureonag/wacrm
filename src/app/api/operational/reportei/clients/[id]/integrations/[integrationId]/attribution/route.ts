// /api/operational/reportei/clients/:id/integrations/:integrationId/attribution
//   GET → { windows: string[] | null, available }   the attribution windows asked of Meta for this
//         link (null = whatever Meta applies by default). view_tasks.
//   PUT { windows: string[] | null } → set them. Only known windows are accepted (an empty list or
//         an unknown window is refused, never read as "the default"). edit_boards.
// The column exists after migration 181; before it, GET says available:false and PUT answers
// 503 { error: "migration_pending" }.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseAttributionWindows } from "@/lib/reportei/event-config";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; integrationId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id, integrationId } = await params;
    if (!isUuid(id) || !isUuid(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase.from("ad_integrations").select("attribution_windows").eq("id", integrationId).eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (error) return NextResponse.json({ windows: null, available: false });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ windows: (data.attribution_windows as string[] | null) ?? null, available: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id, integrationId } = await params;
    if (!isUuid(id) || !isUuid(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { windows?: unknown } | null;
    const windows = parseAttributionWindows(body?.windows);
    if (windows === undefined) return NextResponse.json({ error: "Invalid windows" }, { status: 400 });

    const { data, error } = await ctx.supabase.from("ad_integrations").update({ attribution_windows: windows }).eq("id", integrationId).eq("client_id", id).eq("account_id", ctx.accountId).select("id");
    if (error) {
      if (error.code === "42703" || /attribution_windows/.test(error.message)) return NextResponse.json({ error: "migration_pending" }, { status: 503 });
      console.error("[PUT reportei attribution]", error.message);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ windows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
