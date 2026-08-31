import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/prospecting/admin-client";
import { advanceRun } from "@/lib/prospecting/engine";
import { PROSPECTING_CLAIMABLE_STATUSES } from "@/lib/prospecting/constants";

const BATCH_LIMIT = 50;
const LEASE_MS = 2 * 60 * 1000;

/**
 * GET /api/prospecting/cron
 *
 * Drains claimable `prospecting_runs` rows (queued/searching/enriching/
 * scoring/importing — NOT `awaiting_review`, which waits on a human).
 * Meant to be hit on a schedule (see docs/prospecting-cron.md) —
 * requires the shared secret via `x-cron-secret`, reusing
 * `AUTOMATION_CRON_SECRET` (the same one `/api/automations/cron` and
 * `/api/flows/cron` already use) so operators only provision one.
 *
 * Claim mechanism: a `claimed_until` lease, not the binary
 * pending/running flag `automations/cron` uses — a 10-state resumable
 * run doesn't fit a two-value claim column. Best-effort only, like the
 * automations cron: a conditional UPDATE serves as the lock so
 * overlapping invocations don't double-process the same row.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("prospecting_runs")
    .select("id")
    .in("status", PROSPECTING_CLAIMABLE_STATUSES as unknown as string[])
    .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 });

  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  let processed = 0;

  for (const row of due) {
    const { data: claim } = await admin
      .from("prospecting_runs")
      .update({ claimed_until: leaseUntil })
      .eq("id", row.id as string)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select("id")
      .maybeSingle();
    if (!claim) continue; // another concurrent tick already claimed it

    await advanceRun(row.id as string, admin);
    processed++;
  }

  return NextResponse.json({ processed });
}
