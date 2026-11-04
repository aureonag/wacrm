// POST /api/operational/affiliates/clients/:id/integrations/nuvemshop/connect
//   body { returnTo?: string }  → { url }
//
// The address the person must open to authorize the app on their store. The
// `state` inside it is signed and names THIS client, so when the Nuvemshop
// sends the merchant back the store is linked to the right client.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { nuvemshopConfig } from "@/lib/affiliates/nuvemshop/api";
import { authorizeUrl } from "@/lib/affiliates/nuvemshop/install";
import { safeReturnPath, signInstallState } from "@/lib/affiliates/nuvemshop/security";
import { getIntegrationForClient } from "@/lib/affiliates/nuvemshop/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["integrations", "edit"]]);

    const cfg = nuvemshopConfig();
    if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });

    const existing = await getIntegrationForClient(id, admin);
    if (existing?.status === "connected") {
      return NextResponse.json({ error: "Este cliente já tem uma loja Nuvemshop conectada. Desconecte antes de conectar outra." }, { status: 409 });
    }

    const body = (await req.json().catch(() => null)) as { returnTo?: unknown } | null;
    const returnTo = safeReturnPath(typeof body?.returnTo === "string" ? body.returnTo : null, `/operational/afiliados/clientes/${id}/integracoes`);
    const state = signInstallState({ clientId: id, returnTo }, cfg.appSecret);

    await writeAudit(admin, ctx, { clientId: id, action: "Iniciou a conexão da Nuvemshop", objectType: "integration", objectId: id });
    return NextResponse.json({ url: authorizeUrl(cfg.appId, state) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
