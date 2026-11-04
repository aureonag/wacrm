// POST /api/operational/affiliates/clients/:id/integrations/nuvemshop/sync
//   -> creates / updates / removes the coupons of every participant in the store
//      and reads the store's recent orders again (safety net for a missed
//      webhook). Runs now and answers with what happened.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireClientAccess } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { NuvemshopError } from "@/lib/affiliates/nuvemshop/api";
import { syncClientCoupons } from "@/lib/affiliates/nuvemshop/coupons";
import { importRecentOrders } from "@/lib/affiliates/nuvemshop/orders-sync";
import { getIntegrationForClient, patchIntegration } from "@/lib/affiliates/nuvemshop/store";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["integrations", "edit"]]);

    // Each run talks to the Nuvemshop dozens of times: one at a time per person.
    const limit = checkRateLimit(`affiliates:nuvemshopSync:${ctx.userId}`, { limit: 3, windowMs: 60_000 });
    if (!limit.success) return rateLimitResponse(limit);

    const integration = await getIntegrationForClient(id, admin);
    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ error: "A Nuvemshop não está conectada." }, { status: 409 });
    }

    try {
      const coupons = await syncClientCoupons(id, admin);
      const orders = await importRecentOrders(integration, 30, admin);
      return NextResponse.json({ coupons, orders });
    } catch (err) {
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) {
        await patchIntegration(integration.id, { status: "error", last_error: "A loja não autoriza mais o app. Reconecte a Nuvemshop." }, admin);
        return NextResponse.json({ error: "A loja não autoriza mais o app. Reconecte a Nuvemshop." }, { status: 409 });
      }
      console.error("[POST nuvemshop/sync]", err instanceof Error ? err.message : "unknown error");
      return NextResponse.json({ error: "Não foi possível sincronizar agora. Tente de novo em instantes." }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
