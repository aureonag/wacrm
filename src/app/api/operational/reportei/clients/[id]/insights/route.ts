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
import { isPeriod, resolvePeriod } from "@/lib/reportei/periods";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const wanted = new URL(req.url).searchParams.get("period") ?? "last_30d";
    if (!isPeriod(wanted)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    const period = resolvePeriod(wanted);

    const accounts = await collectAccountSnapshots(ctx, id, period).catch((err: unknown) => {
      console.error("[GET reportei/clients/:id/insights]", err instanceof Error ? err.message : err);
      return null;
    });
    if (!accounts) return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });

    return NextResponse.json({ period: { key: wanted, ...period }, accounts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
