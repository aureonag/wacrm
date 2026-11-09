// GET /api/operational/reportei/meta/connect?returnTo=/operational/reportei/...[&reconnect=<connectionId>]
// Starts "Entrar com Facebook": sends the person to Meta's sign-in. Needs
// edit_boards (connecting is part of linking ad accounts).
//
// The state's nonce is also put in a short-lived HttpOnly cookie of this browser;
// the callback only accepts a state whose nonce matches it, and clears it, so a
// state cannot be replayed from another browser or used twice. With `reconnect`,
// the callback insists on the same Meta identity as that connection.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { buildAuthUrl, isMetaLoginConfigured, OAUTH_NONCE_COOKIE, safeReturnTo, signState, withMetaResult } from "@/lib/reportei/meta-oauth";
import { callbackUrl, getConnectionIdentity, siteOrigin } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const params = new URL(req.url).searchParams;
    const returnTo = safeReturnTo(params.get("returnTo"));
    const back = (result: string) => NextResponse.redirect(`${siteOrigin(req)}${withMetaResult(returnTo, result)}`);

    if (!isMetaLoginConfigured()) return back("not_configured");

    // Reconnecting a connection: it has to be this company's.
    const reconnect = params.get("reconnect");
    if (reconnect) {
      if (!UUID.test(reconnect)) return back("error");
      const known = await getConnectionIdentity(ctx.accountId, reconnect);
      if (!known) return back("error");
    }

    const nonce = randomBytes(16).toString("hex");
    const state = signState({ u: ctx.userId, a: ctx.accountId, r: returnTo, n: nonce, ...(reconnect ? { k: reconnect } : {}) }, process.env.META_ADS_APP_SECRET!);
    const res = NextResponse.redirect(
      buildAuthUrl({
        appId: process.env.META_ADS_APP_ID!,
        redirectUri: callbackUrl(req),
        state,
        configId: process.env.META_ADS_CONFIG_ID?.trim() || undefined,
      }),
    );
    res.cookies.set(OAUTH_NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:", path: "/api/operational/reportei/meta", maxAge: 600 });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
