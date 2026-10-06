// GET /api/portal/store/me — what the logged-in person can open in the store
// portal: their stores and, per store, the role and the effective permissions.
//
// Aureon staff ("Ver como cliente") pass ?client=<id> and get that one store
// with full access. Everyone else needs a portal login (aff_portal).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isUuid } from "@/lib/affiliates/campaigns";
import { loadPortalSession } from "@/lib/affiliates/store-portal";

export async function GET(req: Request) {
  try {
    const client = new URL(req.url).searchParams.get("client");
    const session = await loadPortalSession(isUuid(client) ? client : null);
    return NextResponse.json({
      kind: session.kind,
      name: session.name,
      is_affiliate: session.isAffiliate,
      stores: session.stores,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
