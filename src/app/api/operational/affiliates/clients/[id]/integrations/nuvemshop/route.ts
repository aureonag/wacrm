// GET    /api/operational/affiliates/clients/:id/integrations/nuvemshop
//   -> state of the client's Nuvemshop connection: store, webhooks, how many
//      coupons are in place or failed (and why), how many orders came in. For the
//      Aureon team it also lists stores that installed the app and wait to be linked.
// DELETE -> disconnects: removes the coupons this CRM created, the webhooks and
//      the saved token. Orders already recorded stay.
//
// Aureon staff, or a store user with the right permission (module "integrations").

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { baseUrl } from "@/lib/affiliates/portal-access";
import { nuvemshopConfig } from "@/lib/affiliates/nuvemshop/api";
import { removeClientCoupons } from "@/lib/affiliates/nuvemshop/coupons";
import { removeWebhooks } from "@/lib/affiliates/nuvemshop/install";
import { getIntegrationForClient, getStoreAuth, listPendingIntegrations } from "@/lib/affiliates/nuvemshop/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin, kind } = await requireClientAccess(id, [["integrations", "view"]]);

    const configured = nuvemshopConfig() !== null;
    const integration = await getIntegrationForClient(id, admin);
    const pending = kind === "staff" ? await listPendingIntegrations(admin) : [];

    let coupons: { approved: number; synced: number; failed: number; errors: { code: string; message: string }[] } | null = null;
    let orders: { total: number; paid: number } | null = null;
    if (integration) {
      const [approved, states, orderRows] = await Promise.all([
        admin.from("aff_memberships").select("id", { count: "exact", head: true }).eq("client_id", id).eq("status", "approved"),
        admin
          .from("aff_membership_coupons")
          .select("state, last_error, aff_memberships(code)")
          .eq("integration_id", integration.id),
        admin.from("aff_orders").select("status").eq("client_id", id).eq("integration_id", integration.id),
      ]);
      for (const r of [approved, states, orderRows]) {
        if (r.error) {
          if (isModuleNotReady(r.error)) return moduleNotReadyResponse();
          console.error("[GET nuvemshop status]", r.error.message);
          return NextResponse.json({ error: "Failed to load integration" }, { status: 500 });
        }
      }
      const rows = (states.data ?? []) as unknown as { state: string; last_error: string | null; aff_memberships: { code: string } | null }[];
      coupons = {
        approved: approved.count ?? 0,
        synced: rows.filter((r) => r.state === "synced").length,
        failed: rows.filter((r) => r.state === "error").length,
        errors: rows
          .filter((r) => r.state === "error")
          .slice(0, 5)
          .map((r) => ({ code: r.aff_memberships?.code ?? "", message: r.last_error ?? "" })),
      };
      const o = orderRows.data ?? [];
      orders = { total: o.length, paid: o.filter((x) => x.status === "paid").length };
    }

    return NextResponse.json({ configured, integration, coupons, orders, pending });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["integrations", "edit"]]);

    const integration = await getIntegrationForClient(id, admin);
    if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const auth = integration.status === "connected" ? await getStoreAuth(integration.id, admin) : null;
    if (auth) {
      await removeClientCoupons(admin, auth, integration.id);
      await removeWebhooks(auth, baseUrl(req));
    }
    const { error } = await admin.from("aff_integrations").delete().eq("id", integration.id);
    if (error) {
      console.error("[DELETE nuvemshop]", error.message);
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
    }
    await writeAudit(admin, ctx, { clientId: id, action: "Desconectou a Nuvemshop", objectType: "integration", objectId: integration.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
