// Shared first step of every webhook route: read the raw body, check the
// Nuvemshop HMAC, parse the payload. Anything that fails the check is refused
// before any work is done.

import { NextResponse } from "next/server";
import { nuvemshopConfig } from "./api";
import { verifyWebhookSignature } from "./security";
import { parseWebhookPayload } from "./webhooks";

export type VerifiedWebhook = { payload: NonNullable<ReturnType<typeof parseWebhookPayload>> };

export async function readVerifiedWebhook(req: Request): Promise<VerifiedWebhook | NextResponse> {
  const cfg = nuvemshopConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // The signature covers the raw text: never re-serialize before checking.
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-linkedstore-hmac-sha256"), cfg.appSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const payload = parseWebhookPayload(raw);
  if (!payload) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  return { payload };
}
