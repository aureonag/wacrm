// GET  /api/account/sectors — list this account's sectors. Any member.
// POST /api/account/sectors — create a sector. Admin+.

import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { Sector } from "@/types";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("sectors")
      .select("id, account_id, name")
      .eq("account_id", ctx.accountId)
      .order("name");

    if (error) {
      console.error("[GET /api/account/sectors] fetch error:", error);
      return NextResponse.json({ error: "Failed to load sectors" }, { status: 500 });
    }

    return NextResponse.json({ sectors: (data ?? []) as Sector[] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:sectorCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "'name' is required" }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("sectors")
      .insert({ account_id: ctx.accountId, name })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A sector with this name already exists" }, { status: 409 });
      }
      console.error("[POST /api/account/sectors] insert error:", error);
      return NextResponse.json({ error: "Failed to create sector" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
