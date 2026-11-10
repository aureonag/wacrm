import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { fetchAdVideoPreview } from "@/lib/reportei/ad-video";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    const query = new URL(req.url).searchParams;
    const account = query.get("account") ?? "", ad = query.get("ad") ?? "";
    if (!isUuid(id) || !/^act_\d+$/.test(account) || !/^\d{1,30}$/.test(ad)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const link = await ctx.supabase.from("ad_integrations").select("connection_id,campaign_ids")
      .eq("account_id", ctx.accountId).eq("client_id", id).eq("provider", "meta_ads").eq("external_account_id", account).maybeSingle();
    if (link.error) return NextResponse.json({ error: "Integration unavailable" }, { status: 500 });
    if (!link.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const connection = link.data.connection_id ? await getCompanyConnection(ctx.accountId, link.data.connection_id as string) : null;
    if (!connection) return NextResponse.json({ error: "connection_unavailable" }, { status: 409 });
    try {
      const ids = link.data.campaign_ids as string[] | null;
      const url = await fetchAdVideoPreview(connection.token, account, ad, ids?.length ? ids : null);
      return NextResponse.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ error: "video_unavailable" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
    }
  } catch (error) { return toErrorResponse(error); }
}
