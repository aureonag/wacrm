// GET /api/operational/reportei/meta/connect?returnTo=/operational/reportei/...
// Starts "Entrar com Facebook": sends the person to Meta's sign-in. Needs
// edit_boards (connecting is part of linking ad accounts).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { buildAuthUrl, isMetaLoginConfigured, safeReturnTo, signState, withMetaResult } from "@/lib/reportei/meta-oauth";
import { callbackUrl, siteOrigin } from "@/lib/reportei/meta-connection";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
    const back = (result: string) => NextResponse.redirect(`${siteOrigin(req)}${withMetaResult(returnTo, result)}`);

    if (!isMetaLoginConfigured()) return back("not_configured");

    const state = signState({ u: ctx.userId, a: ctx.accountId, r: returnTo }, process.env.META_ADS_APP_SECRET!);
    return NextResponse.redirect(
      buildAuthUrl({
        appId: process.env.META_ADS_APP_ID!,
        redirectUri: callbackUrl(req),
        state,
        configId: process.env.META_ADS_CONFIG_ID?.trim() || undefined,
      }),
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
