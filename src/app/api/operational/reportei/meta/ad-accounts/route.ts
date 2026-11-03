// GET /api/operational/reportei/meta/ad-accounts — the ad accounts Aureon's
// Meta system user can see, for the "Contas da Meta encontradas" picker.
// Never returns the token. Needs edit_boards (it is part of linking accounts).
//
// 200 { configured: false }                   token not set on the server yet
// 200 { configured: true, accounts: [...] }
// 502 { error: "token_invalid" | "permission" | "request_failed" }

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isMetaAdsConfigured, listMetaAdAccounts, MetaAdsError } from "@/lib/reportei/meta-ads";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("operational", "tasks", "edit_boards");
    if (!isMetaAdsConfigured()) return NextResponse.json({ configured: false });
    const accounts = await listMetaAdAccounts();
    return NextResponse.json({ configured: true, accounts });
  } catch (err) {
    if (err instanceof MetaAdsError) {
      if (err.code !== "not_configured") console.error("[GET reportei/meta/ad-accounts]", err.message);
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
