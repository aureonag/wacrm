// POST /api/operational/affiliates/clients/:id/integrations/nuvemshop/link
//   body { integrationId } → links a store that installed the app by itself
//   (from the Nuvemshop's own admin) to THIS client. Aureon staff only: a store
//   user must never be able to claim someone else's store.

import { NextResponse } from "next/server";
import { toErrorResponse, ForbiddenError } from "@/lib/auth/account";
import { requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { syncClientCoupons } from "@/lib/affiliates/nuvemshop/coupons";
import { importRecentOrders } from "@/lib/affiliates/nuvemshop/orders-sync";
import { getIntegrationForClient, INTEGRATION_COLUMNS, patchIntegration, type Integration } from "@/lib/affiliates/nuvemshop/store";
import { after } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin, kind } = await requireClientAccess(id, [["integrations", "edit"]]);
    if (kind !== "staff") throw new ForbiddenError("Only the Aureon team can link a store");

    const body = (await req.json().catch(() => null)) as { integrationId?: unknown } | null;
    if (!isUuid(body?.integrationId)) return NextResponse.json({ error: "Loja inválida." }, { status: 400 });

    const other = await getIntegrationForClient(id, admin);
    if (other) return NextResponse.json({ error: "Este cliente já tem uma loja Nuvemshop conectada." }, { status: 409 });

    const { data, error } = await admin
      .from("aff_integrations")
      .select(INTEGRATION_COLUMNS)
      .eq("id", body.integrationId)
      .eq("platform", "nuvemshop")
      .is("client_id", null)
      .neq("status", "revoked")
      .maybeSingle();
    if (error) {
      console.error("[POST nuvemshop/link]", error.message);
      return NextResponse.json({ error: "Failed to link store" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Esta loja não está mais esperando vínculo." }, { status: 404 });
    const integration = data as Integration;

    await patchIntegration(integration.id, { client_id: id }, admin);
    await writeAudit(admin, ctx, { clientId: id, action: "Vinculou a loja Nuvemshop", objectType: "integration", objectId: integration.id });

    const linked = { ...integration, client_id: id };
    after(async () => {
      try {
        await syncClientCoupons(id);
        await importRecentOrders(linked);
      } catch (err) {
        console.error("[nuvemshop] sync after link failed", err instanceof Error ? err.message : "unknown error");
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
