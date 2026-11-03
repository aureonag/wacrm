// GET /api/operational/reportei/meta/ad-accounts — the ad accounts the signed-in
// person can see through their own Facebook, for the "Contas da Meta
// encontradas" picker. Never returns a token. Needs edit_boards.
//
// 200 { configured: false }                                  Meta app not set up on the server
// 200 { configured: true, connected: false }                 this person has not signed in yet
// 200 { configured: true, connected: true, connection, accounts }
// 502 { error: "token_invalid" | "permission" | "request_failed" }
//     token_invalid also marks the connection so the team sees it must sign in again.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { listMetaAdAccounts, MetaAdsError } from "@/lib/reportei/meta-ads";
import { isMetaLoginConfigured } from "@/lib/reportei/meta-oauth";
import { getConnection, getConnectionToken, markConnectionFailed } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    if (!isMetaLoginConfigured()) return NextResponse.json({ configured: false });

    const connection = await getConnection(ctx.accountId, ctx.userId);
    // An errored connection is treated as not signed in: the person signs in again.
    if (!connection || connection.status !== "connected") return NextResponse.json({ configured: true, connected: false });

    const stored = await getConnectionToken(ctx.accountId, ctx.userId);
    if (!stored) return NextResponse.json({ configured: true, connected: false });

    try {
      const accounts = await listMetaAdAccounts(stored.token);
      return NextResponse.json({
        configured: true,
        connected: true,
        connection: { name: connection.fbUserName, expiresAt: connection.tokenExpiresAt },
        accounts,
      });
    } catch (err) {
      if (err instanceof MetaAdsError && err.code === "token_invalid") {
        await markConnectionFailed(stored.id, "revoked", err.message);
        return NextResponse.json({ configured: true, connected: false });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof MetaAdsError) {
      console.error("[GET reportei/meta/ad-accounts]", err.message);
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
