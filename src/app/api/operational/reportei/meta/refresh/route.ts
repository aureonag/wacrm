// GET /api/operational/reportei/meta/refresh — renews the Meta tokens that are
// close to expiring (~60-day user tokens), so the connection does not drop.
// Meant for a scheduled ping, like automations/cron: needs the shared secret in
// the `x-cron-secret` header (AUTOMATION_CRON_SECRET). Opening the account
// picker also renews a due token, so this is the safety net for quiet weeks.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshDueConnections } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await refreshDueConnections());
  } catch (err) {
    console.error("[GET reportei/meta/refresh]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}
