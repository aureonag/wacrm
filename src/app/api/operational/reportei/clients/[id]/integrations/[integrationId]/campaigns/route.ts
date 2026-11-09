// /api/operational/reportei/clients/:id/integrations/:integrationId/campaigns
//   GET → { campaigns: [{ id, name, status }], selected: string[] | null }
//         the account's campaigns (read from Meta now) and the ones the reports are
//         limited to (null = the whole account). view_tasks.
//   PUT { campaignIds: string[] | null } → limit the reports of this account to
//         those campaigns, or null for the whole account. An empty list, a non-id or a
//         campaign that does not exist in the account is refused (400), never read as
//         "the whole account". edit_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { listCampaigns, MetaAdsError } from "@/lib/reportei/meta-ads";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; integrationId: string }> };

const MAX_SELECTED = 500;

/** Valid campaign ids from untrusted input: undefined = invalid, null = whole account (only when asked for explicitly). */
function parseSelection(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SELECTED) return undefined;
  const ids = [...new Set(v)];
  if (!ids.every((id): id is string => typeof id === "string" && /^\d{1,30}$/.test(id))) return undefined;
  return ids;
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id, integrationId } = await params;
    if (!isUuid(id) || !isUuid(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("ad_integrations")
      .select("external_account_id, connection_id, campaign_ids")
      .eq("id", integrationId)
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[GET reportei campaigns] integration", error.message);
      return NextResponse.json({ error: "Failed to load integration" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const connection = data.connection_id ? await getCompanyConnection(ctx.accountId, data.connection_id as string) : null;
    if (!connection) return NextResponse.json({ error: "connection_unavailable" }, { status: 409 });
    try {
      const campaigns = await listCampaigns(connection.token, data.external_account_id as string);
      return NextResponse.json({ campaigns, selected: (data.campaign_ids as string[] | null) ?? null });
    } catch (err) {
      if (!(err instanceof MetaAdsError)) throw err;
      return NextResponse.json({ error: err.code, detail: err.detail }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id, integrationId } = await params;
    if (!isUuid(id) || !isUuid(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { campaignIds?: unknown } | null;
    const selection = parseSelection(body?.campaignIds);
    if (selection === undefined) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    // The campaigns have to exist in this account: a typo is an error, not an empty or whole-account read.
    if (selection) {
      const link = await ctx.supabase.from("ad_integrations").select("external_account_id, connection_id").eq("id", integrationId).eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
      if (link.error) return NextResponse.json({ error: "Failed to load integration" }, { status: 500 });
      if (!link.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const connection = link.data.connection_id ? await getCompanyConnection(ctx.accountId, link.data.connection_id as string) : null;
      if (!connection) return NextResponse.json({ error: "connection_unavailable" }, { status: 409 });
      try {
        const existing = new Set((await listCampaigns(connection.token, link.data.external_account_id as string)).map((c) => c.id));
        const missing = selection.filter((c) => !existing.has(c));
        if (missing.length > 0) return NextResponse.json({ error: "unknown_campaign", campaigns: missing }, { status: 400 });
      } catch (err) {
        if (!(err instanceof MetaAdsError)) throw err;
        return NextResponse.json({ error: err.code, detail: err.detail }, { status: 502 });
      }
    }

    const { data, error } = await ctx.supabase
      .from("ad_integrations")
      .update({ campaign_ids: selection })
      .eq("id", integrationId)
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .select("id");
    if (error) {
      console.error("[PUT reportei campaigns]", error.message);
      return NextResponse.json({ error: "Failed to save campaigns" }, { status: 500 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ selected: selection });
  } catch (err) {
    return toErrorResponse(err);
  }
}
