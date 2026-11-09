// GET /api/operational/reportei/dashboard?period=last_30d&offset=0&limit=10&refresh=1
// The overview: one row per client that has a Meta ad account linked, with the
// totals of the period and of the previous one. Clients come ordered by name, a
// page at a time, because each one costs a few reads on Meta. Each summary is
// kept for 10 minutes in memory; `refresh=1` reads again. view_tasks.
//
// 200 { period, compare, total, offset, clients: ClientSummary[], goals: { [clientId]: { monthlyBudget, maxCpc } } }

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { goalsFromRow } from "@/lib/reportei/goals";
import { TtlCache, mapLimit, summarizeClient, type ClientSummary } from "@/lib/reportei/dashboard";
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";
import { previousRange } from "@/lib/reportei/report";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE_DEFAULT = 10;
const PAGE_MAX = 25;
const PARALLEL = 3;

// Per server process; a restart simply reads again.
const cache = new TtlCache<ClientSummary>(10 * 60 * 1000);

const intParam = (v: string | null, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const url = new URL(req.url);
    const wanted = url.searchParams.get("period") ?? "this_month";
    if (!isPeriod(wanted)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    const offset = intParam(url.searchParams.get("offset"), 0, 0, 100_000);
    const limit = intParam(url.searchParams.get("limit"), PAGE_DEFAULT, 1, PAGE_MAX);
    const refresh = url.searchParams.get("refresh") === "1";

    const period = resolvePeriod(wanted);
    const compare = previousRange(period.since, period.until);

    const linked = await ctx.supabase.from("ad_integrations").select("client_id").eq("account_id", ctx.accountId).eq("provider", "meta_ads").limit(5000);
    if (linked.error) {
      console.error("[GET reportei/dashboard] integrations", linked.error.message);
      return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });
    }
    const ids = [...new Set((linked.data ?? []).map((r) => r.client_id as string))];
    if (ids.length === 0) return NextResponse.json({ period: { key: wanted, ...period }, compare, total: 0, offset, clients: [], goals: {} });

    const clients = await ctx.supabase.from("ops_clients").select("id, name, code").eq("account_id", ctx.accountId).in("id", ids).order("name", { ascending: true });
    if (clients.error) {
      console.error("[GET reportei/dashboard] clients", clients.error.message);
      return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
    }
    const all = clients.data ?? [];
    const page = all.slice(offset, offset + limit);

    const summaries = await mapLimit(page, PARALLEL, async (c): Promise<ClientSummary> => {
      const who = { clientId: c.id as string, name: c.name as string, code: (c.code as string | null) ?? null };
      const key = `${ctx.accountId}:${who.clientId}:${wanted}:${period.until}`;
      const hit = refresh ? undefined : cache.get(key);
      if (hit) return hit;
      try {
        const accounts = await collectAccountSnapshots(ctx, who.clientId, { ...period, compare });
        const summary = summarizeClient(who, accounts);
        cache.set(key, summary);
        return summary;
      } catch (err) {
        // One client failing never hides the others; it is not cached, so the next try reads again.
        console.error("[GET reportei/dashboard] client", who.clientId, err instanceof Error ? err.message : err);
        return { ...who, accounts: 0, readable: 0, totals: null, previous: null, currency: null, mixedCurrency: false, error: "request_failed" };
      }
    });

    // Goals are read fresh (not cached) so an edit shows on the next load.
    const goalRows = await ctx.supabase
      .from("reportei_client_goals")
      .select("client_id, monthly_budget, max_cpc")
      .eq("account_id", ctx.accountId)
      .in("client_id", page.map((c) => c.id as string));
    if (goalRows.error) console.error("[GET reportei/dashboard] goals", goalRows.error.message);
    const goals = Object.fromEntries((goalRows.data ?? []).map((g) => [g.client_id as string, goalsFromRow(g)]));

    return NextResponse.json({ period: { key: wanted, ...period }, compare, total: all.length, offset, clients: summaries, goals });
  } catch (err) {
    return toErrorResponse(err);
  }
}
