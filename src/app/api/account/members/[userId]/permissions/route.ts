// PUT /api/account/members/[userId]/permissions — replace a teammate's
// permission overrides (migration 079). Admin+. Currently used for
// per-person nav-item visibility (comercial:*:view), but the RPC
// underneath is generic to any permission.

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") return NextResponse.json({ error: err.message }, { status: 403 });
  if (err.code === "22023") return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[members/permissions route] unexpected RPC error:", err);
  return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
}

interface OverrideInput {
  permission_id: string;
  granted: boolean;
}

function isOverrideInput(v: unknown): v is OverrideInput {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as OverrideInput).permission_id === "string" &&
    typeof (v as OverrideInput).granted === "boolean"
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:memberPermissions:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as { overrides?: unknown } | null;
    if (!Array.isArray(body?.overrides) || !body.overrides.every(isOverrideInput)) {
      return NextResponse.json(
        { error: "'overrides' must be an array of {permission_id, granted}" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_permission_overrides", {
      p_user_id: userId,
      p_overrides: body.overrides,
    });

    if (error) return rpcErrorToResponse(error);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
