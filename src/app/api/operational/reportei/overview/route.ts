// GET /api/operational/reportei/overview?since=YYYY-MM-DD&until=YYYY-MM-DD[&compare=0][&refresh=1]
// The general dashboard from the real Meta accounts of every active client: readings
// with their states (null + why, never an invented zero), and the current month's
// daily series (investment and purchase value) next to the same days of the month
// before. Needs view_tasks. Read-only: nothing is written and no token leaves the server.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { buildOverview } from "@/lib/reportei/overview-real";
import { isValidRange, previousRange } from "@/lib/reportei/report";
import { resolvePeriod } from "@/lib/reportei/periods";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The month so far (day 1 to today) and the same days of the month before. */
function monthSpans(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const days = Math.min(Number(today.slice(8, 10)), lastDay);
  return { month: { since: `${today.slice(0, 8)}01`, until: today }, before: { since: ymd(start), until: ymd(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), days))) } };
}

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const q = new URL(req.url).searchParams;
    const today = resolvePeriod("last_7d").until;
    const since = q.get("since") ?? "";
    const until = q.get("until") ?? "";
    if (!YMD.test(since) || !YMD.test(until) || !isValidRange(since, until, today)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    if ((new Date(`${until}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime()) / DAY > 366) return NextResponse.json({ error: "Period too long" }, { status: 400 });
    const compare = q.get("compare") !== "0";

    const clients = await ctx.supabase.from("ops_clients").select("id").eq("account_id", ctx.accountId).eq("status", "active").limit(1000);
    if (clients.error) {
      console.error("[GET reportei/overview]", clients.error.message);
      return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
    }

    const spans = monthSpans(today);
    const payload = await buildOverview(ctx, {
      clientIds: (clients.data ?? []).map((c) => c.id as string),
      range: { since, until },
      before: compare ? previousRange(since, until) : null,
      month: spans.month,
      monthBefore: spans.before,
      refresh: q.get("refresh") === "1",
    });
    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}
