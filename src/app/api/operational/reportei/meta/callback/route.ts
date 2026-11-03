// GET /api/operational/reportei/meta/callback — where Facebook sends the person
// back after "Entrar com Facebook". Checks the signed state (same person, not
// expired), trades the code for a long-lived token and stores it encrypted.
// Always ends with a redirect to the page the person came from, carrying
// `meta=connected | denied | error | not_configured` for the page to react to.

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { exchangeCode, fetchMetaProfile, isMetaLoginConfigured, safeReturnTo, verifyState, withMetaResult } from "@/lib/reportei/meta-oauth";
import { callbackUrl, saveConnection, siteOrigin } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallback = safeReturnTo(null);
  const go = (path: string, result: string) => NextResponse.redirect(`${siteOrigin(req)}${withMetaResult(path, result)}`);

  try {
    if (!isMetaLoginConfigured()) return go(fallback, "not_configured");
    const ctx = await requirePermission("operational", "tasks", "edit_boards");

    const state = verifyState(url.searchParams.get("state"), process.env.META_ADS_APP_SECRET!);
    // A bad, expired or someone else's state never gets to exchange a code.
    if (!state || state.u !== ctx.userId || state.a !== ctx.accountId) return go(fallback, "error");
    const returnTo = safeReturnTo(state.r);

    if (url.searchParams.get("error")) return go(returnTo, "denied");
    const code = url.searchParams.get("code");
    if (!code) return go(returnTo, "error");

    const { token, expiresAt } = await exchangeCode({ code, redirectUri: callbackUrl(req) });
    const profile = await fetchMetaProfile(token);
    await saveConnection({
      accountId: ctx.accountId,
      userId: ctx.userId,
      fbUserId: profile.id,
      fbUserName: profile.name,
      token,
      expiresAt,
    });
    return go(returnTo, "connected");
  } catch (err) {
    console.error("[GET reportei/meta/callback]", err instanceof Error ? err.message : "unknown error");
    return go(fallback, "error");
  }
}
