// GET /api/integrations/nuvemshop/callback — where the Nuvemshop sends the
// merchant after they authorize the app (the "URL de redirecionamento" of the
// app #50395). Two ways to get here:
//
//  1. The team (or the store's owner) clicked "Conectar Nuvemshop" in the CRM:
//     `state` is our signed token naming the client, and the person goes back to
//     the Integrações page with `?nuvemshop=<result>`.
//  2. The merchant installed from the Nuvemshop's own admin: no `state`. The
//     store is saved unlinked, the team links it to a client later, and the
//     merchant sees a thank-you page.

import { after, NextResponse } from "next/server";
import { baseUrl } from "@/lib/affiliates/portal-access";
import { nuvemshopConfig } from "@/lib/affiliates/nuvemshop/api";
import { completeInstall } from "@/lib/affiliates/nuvemshop/install";
import { importRecentOrders } from "@/lib/affiliates/nuvemshop/orders-sync";
import { syncClientCoupons } from "@/lib/affiliates/nuvemshop/coupons";
import { safeReturnPath, verifyInstallState, withResult } from "@/lib/affiliates/nuvemshop/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = baseUrl(req);
  const cfg = nuvemshopConfig();

  const rawState = url.searchParams.get("state");
  const state = cfg ? verifyInstallState(rawState, cfg.appSecret) : null;
  // A `state` that does not check out is refused: it is either expired or forged.
  const hadBadState = Boolean(rawState) && !state;

  const finish = (result: string) => {
    if (state) {
      const back = safeReturnPath(state.r, "/operational/afiliados/clientes");
      return NextResponse.redirect(`${origin}${withResult(back, result)}`);
    }
    return NextResponse.redirect(`${origin}/integracoes/nuvemshop/instalado?status=${encodeURIComponent(result)}`);
  };

  if (!cfg) return finish("not_configured");
  if (hadBadState) return finish("error");
  if (url.searchParams.get("error")) return finish("denied");
  const code = url.searchParams.get("code");
  if (!code) return finish("error");

  try {
    const result = await completeInstall({ code, clientId: state?.c ?? null, origin });
    if (!result.ok) return finish(result.reason === "client_has_other_store" ? "other_store" : result.reason === "not_configured" ? "not_configured" : "error");

    const { integration } = result;
    if (integration.client_id) {
      const clientId = integration.client_id;
      // Coupons for everyone already approved, and the recent orders, without making the person wait.
      after(async () => {
        try {
          await syncClientCoupons(clientId);
          await importRecentOrders(integration);
        } catch (err) {
          console.error("[nuvemshop] first sync failed", err instanceof Error ? err.message : "unknown error");
        }
      });
    }
    return finish(integration.client_id ? "connected" : "installed");
  } catch (err) {
    console.error("[GET nuvemshop/callback]", err instanceof Error ? err.message : "unknown error");
    return finish("error");
  }
}
