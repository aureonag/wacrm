// GET /api/operational/reportei/meta/ad-accounts — the ad accounts the company's
// Meta connections can see, for the "Contas da Meta encontradas" picker. The
// connections are shared: whoever can link accounts here reads through the ones
// the team already signed in with, so only those people need a role on the Meta
// app. Never returns a token. Needs edit_boards.
//
// 200 { configured: false }                                  Meta app not set up on the server
// 200 { configured: true, connected: false }                 nobody signed in yet
// 200 { configured: true, connected: true, connections: [{ name }], accounts }
//     each account carries the `connectionId` that can read it.
// 502 { error: "request_failed" | "permission" }             every connection failed

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { listMetaAdAccounts, MetaAdsError, mergeConnectionAccounts, type MetaAdAccount } from "@/lib/reportei/meta-ads";
import { isMetaLoginConfigured } from "@/lib/reportei/meta-oauth";
import { listCompanyConnections, markConnectionFailed } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    if (!isMetaLoginConfigured()) return NextResponse.json({ configured: false });

    const connections = await listCompanyConnections(ctx.accountId);
    if (connections.length === 0) return NextResponse.json({ configured: true, connected: false });

    const lists: { connectionId: string; accounts: MetaAdAccount[] }[] = [];
    const working: { name: string | null }[] = [];
    let lastError: MetaAdsError | null = null;
    for (const c of connections) {
      try {
        lists.push({ connectionId: c.id, accounts: await listMetaAdAccounts(c.token) });
        working.push({ name: c.fbUserName });
      } catch (err) {
        if (!(err instanceof MetaAdsError)) throw err;
        lastError = err;
        // A dead login is marked so the team sees it needs to sign in again; the others keep working.
        if (err.code === "token_invalid") await markConnectionFailed(c.id, "revoked", err.message);
        else console.error("[GET reportei/meta/ad-accounts]", err.message);
      }
    }

    if (working.length === 0) {
      // Every connection was revoked: ask for a new sign-in. Any other failure is an error.
      if (lastError?.code === "token_invalid") return NextResponse.json({ configured: true, connected: false });
      return NextResponse.json({ error: lastError?.code ?? "request_failed" }, { status: 502 });
    }

    return NextResponse.json({
      configured: true,
      connected: true,
      connections: working,
      accounts: mergeConnectionAccounts(lists),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
