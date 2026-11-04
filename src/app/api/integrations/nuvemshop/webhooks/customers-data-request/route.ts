// POST /api/integrations/nuvemshop/webhooks/customers-data-request — LGPD
// webhook the Nuvemshop requires: a buyer asked which data we hold about them.
//
// We hold none: the integration never stores a buyer's personal data (only
// order id, amount, status and the coupon code of an affiliate). Acknowledged.

import { NextResponse } from "next/server";
import { readVerifiedWebhook } from "@/lib/affiliates/nuvemshop/webhook-request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verified = await readVerifiedWebhook(req);
  if (verified instanceof NextResponse) return verified;
  console.info("[nuvemshop] customers/data_request acknowledged for store", String(verified.payload.store_id), "- no buyer data is stored");
  return NextResponse.json({ ok: true });
}
