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
import { diagnoseToken, listConnectionAdAccounts, MetaAdsError, mergeConnectionAccounts, type MetaAdAccount } from "@/lib/reportei/meta-ads";
import { isMetaLoginConfigured } from "@/lib/reportei/meta-oauth";
import { listCompanyConnections, listCompanyConnectionSummaries, markConnectionFailed, refreshConnectionIfDue } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const configured = isMetaLoginConfigured();
    // Existing credentials can still read without the app's login configuration.
    // Keep this separate from the ability to start or renew an authorization.
    const [connections, summaries] = await Promise.all([
      listCompanyConnections(ctx.accountId),
      listCompanyConnectionSummaries(ctx.accountId),
    ]);
    const setup = { configured, oauthConfigured: configured, connections: summaries };
    if (connections.length === 0) return NextResponse.json({ ...setup, connected: false });

    // ?diagnose=1: what each connection's token can see (scopes, granted assets, Meta's errors). Never the token.
    if (new URL(req.url).searchParams.get("diagnose") === "1") {
      const diagnostics = [];
      for (const c of connections) diagnostics.push({ name: c.fbUserName, ...(await diagnoseToken(c.token)) });
      return NextResponse.json({ diagnostics });
    }

    const lists: { connectionId: string; accounts: MetaAdAccount[] }[] = [];
    const working: { name: string | null }[] = [];
    let lastError: MetaAdsError | null = null;
    for (const stored of connections) {
      // Renew a token that is close to its end while we have it in hand.
      const c = configured ? await refreshConnectionIfDue(stored) : stored;
      try {
        lists.push({ connectionId: c.id, accounts: await listConnectionAdAccounts(c.token) });
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
      if (lastError?.code === "token_invalid") return NextResponse.json({ ...setup, connected: false });
      return NextResponse.json({ ...setup, error: lastError?.code ?? "request_failed", detail: lastError?.detail }, { status: 502 });
    }

    return NextResponse.json({
      ...setup,
      connected: true,
      accounts: mergeConnectionAccounts(lists),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
