// GET /api/operational/reportei/clients/:id/insights?period=last_30d
// The numbers of each ad account linked to the client (spend, impressions,
// reach, clicks, CTR, CPC, CPM) for a period, read from Meta with ads_read
// through the company connection each account was linked under. Never returns
// a token. Needs view_tasks, like the rest of the client page.
//
// 200 { period: { since, until }, accounts: [{ id, name, currency, insights } | { id, name, currency, error, detail? }] }

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { fetchAccountInsights, MetaAdsError, type AccountInsights } from "@/lib/reportei/meta-ads";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

type AccountResult =
  | { id: string; name: string; currency: string | null; insights: AccountInsights }
  | { id: string; name: string; currency: string | null; error: "connection_unavailable" | "token_invalid" | "permission" | "request_failed"; detail?: string };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const wanted = new URL(req.url).searchParams.get("period") ?? "last_30d";
    if (!isPeriod(wanted)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    const period = resolvePeriod(wanted);

    const rows = await ctx.supabase
      .from("ad_integrations")
      .select("external_account_id, external_account_name, currency, connection_id")
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .eq("provider", "meta_ads")
      .order("created_at", { ascending: true });
    if (rows.error) {
      console.error("[GET reportei/clients/:id/insights]", rows.error.message);
      return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });
    }

    const connections = new Map<string, Awaited<ReturnType<typeof getCompanyConnection>>>();
    const accounts: AccountResult[] = [];
    for (const r of rows.data ?? []) {
      const base = { id: r.external_account_id as string, name: (r.external_account_name as string | null) ?? (r.external_account_id as string), currency: (r.currency as string | null) ?? null };
      const connectionId = r.connection_id as string | null;
      if (!connectionId) {
        accounts.push({ ...base, error: "connection_unavailable" });
        continue;
      }
      if (!connections.has(connectionId)) connections.set(connectionId, await getCompanyConnection(ctx.accountId, connectionId));
      const connection = connections.get(connectionId);
      if (!connection) {
        accounts.push({ ...base, error: "connection_unavailable" });
        continue;
      }
      try {
        accounts.push({ ...base, insights: await fetchAccountInsights(connection.token, base.id, period.since, period.until) });
      } catch (err) {
        if (!(err instanceof MetaAdsError)) throw err;
        accounts.push({ ...base, error: err.code === "not_configured" ? "request_failed" : err.code, detail: err.detail });
      }
    }

    return NextResponse.json({ period: { key: wanted, ...period }, accounts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
