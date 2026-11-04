// POST /api/integrations/nuvemshop/webhooks/customers-redact — LGPD webhook the
// Nuvemshop requires: a buyer asked for their data to be erased.
//
// Nothing to erase: the integration never stores a buyer's personal data. An
// attributed order keeps only its id, amount, status and coupon code. The
// request is acknowledged (and logged without personal data) so the Nuvemshop
// sees it was received.

import { NextResponse } from "next/server";
import { readVerifiedWebhook } from "@/lib/affiliates/nuvemshop/webhook-request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verified = await readVerifiedWebhook(req);
  if (verified instanceof NextResponse) return verified;
  console.info("[nuvemshop] customers/redact acknowledged for store", String(verified.payload.store_id), "- no buyer data is stored");
  return NextResponse.json({ ok: true });
}
