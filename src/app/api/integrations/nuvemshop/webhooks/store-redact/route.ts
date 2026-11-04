// POST /api/integrations/nuvemshop/webhooks/store-redact — LGPD webhook the
// Nuvemshop requires: sent after a merchant uninstalls the app. We delete the
// store's connection and token.

import { after, NextResponse } from "next/server";
import { readVerifiedWebhook } from "@/lib/affiliates/nuvemshop/webhook-request";
import { redactStore } from "@/lib/affiliates/nuvemshop/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verified = await readVerifiedWebhook(req);
  if (verified instanceof NextResponse) return verified;
  const storeId = String(verified.payload.store_id);
  after(() => redactStore(storeId));
  return NextResponse.json({ ok: true });
}
