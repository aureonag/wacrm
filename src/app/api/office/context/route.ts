import { NextResponse } from "next/server";

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { getOfficeContext, OfficeConfigurationError } from "@/lib/office/access";
import { OFFICE_FEATURE_DISABLED } from "@/lib/office/context-status";
import { isOfficeEnabled } from "@/lib/office/runtime/server";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET() {
  try {
    const context = await getOfficeContext();
    if (!isOfficeEnabled()) {
      return NextResponse.json({ error: "O escritório está indisponível.", code: OFFICE_FEATURE_DISABLED }, {
        status: 503, headers: privateHeaders,
      });
    }
    return NextResponse.json(context, { headers: privateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Office access is restricted" }, { status: 403, headers: privateHeaders });
    }
    if (err instanceof OfficeConfigurationError) {
      return NextResponse.json({ error: "Office is not configured" }, { status: 503, headers: privateHeaders });
    }
    console.error("[GET /api/office/context] unexpected error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: privateHeaders });
  }
}
