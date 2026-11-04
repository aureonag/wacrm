// POST /api/integrations/nuvemshop/webhooks/events — order events and
// app/uninstalled, registered on every store when it installs the app.
//
// The Nuvemshop wants a 2xx within 3 seconds or it retries, so the work runs
// after the response. The HMAC is checked first: only the Nuvemshop gets in.

import { after, NextResponse } from "next/server";
import { readVerifiedWebhook } from "@/lib/affiliates/nuvemshop/webhook-request";
import { handleWebhookEvent } from "@/lib/affiliates/nuvemshop/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verified = await readVerifiedWebhook(req);
  if (verified instanceof NextResponse) return verified;
  const { payload } = verified;
  after(() => handleWebhookEvent(payload));
  return NextResponse.json({ ok: true });
}
