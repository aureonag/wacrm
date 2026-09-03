// PATCH /api/account/members/[userId]/cargo — assign a custom cargo
// (migration 058) to a teammate. Admin+. Separate from the existing
// PATCH /api/account/members/[userId], which changes the base
// owner/admin/agent/viewer `account_role` — that endpoint is untouched.

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") return NextResponse.json({ error: err.message }, { status: 403 });
  if (err.code === "22023") return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[members/cargo route] unexpected RPC error:", err);
  return NextResponse.json({ error: "Failed to update cargo" }, { status: 500 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:memberCargo:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as { role_id?: unknown } | null;
    const roleId = body?.role_id;
    if (roleId !== null && typeof roleId !== "string") {
      return NextResponse.json({ error: "'role_id' must be a string or null" }, { status: 400 });
    }

    const { error } = await ctx.supabase.rpc("set_member_custom_role", {
      p_user_id: userId,
      p_role_id: roleId,
    });

    if (error) return rpcErrorToResponse(error);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
