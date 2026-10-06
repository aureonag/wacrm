// GET /api/operational/affiliates/system — the Desenvolvimento screen: real
// health checks of what the Afiliados module depends on. Booleans only —
// never a secret, a key or a connection string.
//
// Staff only (owner/admin) — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireStaff } from "@/lib/affiliates/admin";
import { isPortalReady } from "@/lib/affiliates/portal";
import { isEmailConfigured } from "@/lib/contracts/email";

const BUCKET = "affiliates-docs";

export async function GET() {
  try {
    const { admin } = await requireStaff();

    const [core, portal, bucket, codes] = await Promise.all([
      admin.from("aff_clients").select("id", { count: "exact", head: true }),
      isPortalReady(admin),
      admin.storage.getBucket(BUCKET),
      admin.from("aff_signup_codes").select("email", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      checks: {
        database: !core.error,
        portal_users: portal,
        storage: !bucket.error && bucket.data?.public === false,
        signup_codes: !codes.error,
        email: isEmailConfigured(),
      },
      // The store / payment connectors are not built yet.
      providers: { nuvemshop: false, tray: false, asaas: false },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
