// GET /api/account/permissions — the global permissions catalog
// (migration 058). Not account-scoped: it's the list of capabilities the
// platform knows how to offer, same for every account. Any signed-in
// member can read it (needed to render the permission matrix, even for
// a non-admin viewing a cargo read-only).

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import type { Permission } from "@/types";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("permissions")
      .select("id, environment, module, action, label")
      .order("environment")
      .order("module")
      .order("action");

    if (error) {
      console.error("[GET /api/account/permissions] fetch error:", error);
      return NextResponse.json({ error: "Failed to load permissions" }, { status: 500 });
    }

    return NextResponse.json({ permissions: (data ?? []) as Permission[] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
