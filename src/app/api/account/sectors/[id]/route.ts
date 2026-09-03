// DELETE /api/account/sectors/[id] — admin+.

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:sectorDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const { data, error } = await ctx.supabase.from("sectors").delete().eq("id", id).select("id").maybeSingle();

    if (error) {
      console.error("[DELETE /api/account/sectors/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete sector" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Sector not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
