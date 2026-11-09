// GET /api/operational/reportei/dashboard/:clientId?period=last_30d
// The live panel of one client: every linked Meta ad account for the period,
// against the previous one, with the day-by-day series — the same shape a saved
// report keeps in its snapshot, but read now and not saved. view_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { goalsFromRow } from "@/lib/reportei/goals";
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";
import { previousRange } from "@/lib/reportei/report";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { clientId } = await params;
    if (!isUuid(clientId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const wanted = new URL(req.url).searchParams.get("period") ?? "last_30d";
    if (!isPeriod(wanted)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id, name, code").eq("id", clientId).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) {
      console.error("[GET reportei/dashboard/:id] client", client.error.message);
      return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const period = resolvePeriod(wanted);
    const compare = previousRange(period.since, period.until);
    const accounts = await collectAccountSnapshots(ctx, clientId, { ...period, compare, daily: true }).catch((err: unknown) => {
      console.error("[GET reportei/dashboard/:id]", err instanceof Error ? err.message : err);
      return null;
    });
    if (!accounts) return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });

    const goalRow = await ctx.supabase.from("reportei_client_goals").select("monthly_budget, max_cpc").eq("client_id", clientId).eq("account_id", ctx.accountId).maybeSingle();

    return NextResponse.json({
      goals: goalsFromRow(goalRow.data),
      client: { id: client.data.id, name: client.data.name, code: client.data.code ?? null },
      period: { key: wanted, ...period },
      snapshot: { period, compare, accounts },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
