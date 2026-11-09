// GET /api/operational/reportei/meta/callback — where Facebook sends the person
// back after "Entrar com Facebook". Checks the signed state (same person, same
// browser, not expired, used once), trades the code for a long-lived token and
// stores it encrypted without ever replacing another authorization.
// Always ends with a redirect to the page the person came from, carrying
// `meta=connected | denied | error | not_configured | identity_conflict |
//  identity_mismatch` for the page to react to.
//
//  - A new Meta identity is added next to the others.
//  - The same identity signing in again refreshes its own connection; every link
//    made through it is checked again, keeping ids, campaign filters and reports.
//  - `reconnect` (a known connection) with another Meta identity: refused.

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { exchangeCode, fetchMetaProfile, isMetaLoginConfigured, nonceMatches, OAUTH_NONCE_COOKIE, readCookie, safeReturnTo, verifyState, withMetaResult } from "@/lib/reportei/meta-oauth";
import { callbackUrl, getConnectionIdentity, saveConnectionSafe, siteOrigin } from "@/lib/reportei/meta-connection";
import { revalidateConnectionLinks } from "@/lib/reportei/meta-link";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallback = safeReturnTo(null);
  // Every answer drops the nonce cookie: it is good for one trip only.
  const go = (path: string, result: string) => {
    const res = NextResponse.redirect(`${siteOrigin(req)}${withMetaResult(path, result)}`);
    res.cookies.set(OAUTH_NONCE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/operational/reportei/meta", maxAge: 0 });
    return res;
  };

  try {
    if (!isMetaLoginConfigured()) return go(fallback, "not_configured");
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const state = verifyState(url.searchParams.get("state"), process.env.META_ADS_APP_SECRET!);
    // A bad, expired, someone else's or another browser's state never gets to exchange a code.
    if (!state || state.u !== ctx.userId || state.a !== ctx.accountId) return go(fallback, "error");
    if (!nonceMatches(readCookie(req.headers.get("cookie"), OAUTH_NONCE_COOKIE), state)) return go(fallback, "error");
    const returnTo = safeReturnTo(state.r);

    if (url.searchParams.get("error")) return go(returnTo, "denied");
    const code = url.searchParams.get("code");
    if (!code) return go(returnTo, "error");

    const { token, expiresAt } = await exchangeCode({ code, redirectUri: callbackUrl(req) });
    const profile = await fetchMetaProfile(token);

    // Reconnecting a known connection: the person must be the same Meta identity.
    if (state.k) {
      const known = await getConnectionIdentity(ctx.accountId, state.k);
      if (!known) return go(returnTo, "error");
      if (known.fbUserId !== profile.id) return go(returnTo, "identity_mismatch");
    }

    const saved = await saveConnectionSafe({ accountId: ctx.accountId, userId: ctx.userId, fbUserId: profile.id, fbUserName: profile.name, token, expiresAt });
    if (saved.kind === "identity_conflict") return go(returnTo, "identity_conflict");

    // Back from an error, every link through this login is proven again, one by one.
    if (saved.kind === "refreshed") {
      try {
        await revalidateConnectionLinks(saved.id, token);
      } catch (err) {
        console.error("[GET reportei/meta/callback] revalidate", err instanceof Error ? err.message : "unknown error");
      }
    }
    return go(returnTo, "connected");
  } catch (err) {
    console.error("[GET reportei/meta/callback]", err instanceof Error ? err.message : "unknown error");
    return go(fallback, "error");
  }
}
