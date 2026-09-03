// PUT /api/account/members/[userId]/sectors — replace a teammate's
// sector assignments (migration 058). Admin+.

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") return NextResponse.json({ error: err.message }, { status: 403 });
  if (err.code === "22023") return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[members/sectors route] unexpected RPC error:", err);
  return NextResponse.json({ error: "Failed to update sectors" }, { status: 500 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:memberSectors:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as { sector_ids?: unknown } | null;
    if (!Array.isArray(body?.sector_ids) || !body.sector_ids.every((s) => typeof s === "string")) {
      return NextResponse.json({ error: "'sector_ids' must be an array of strings" }, { status: 400 });
    }

    const { error } = await ctx.supabase.rpc("set_member_sectors", {
      p_user_id: userId,
      p_sector_ids: body.sector_ids,
    });

    if (error) return rpcErrorToResponse(error);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
