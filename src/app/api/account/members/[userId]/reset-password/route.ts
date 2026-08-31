// ============================================================
// POST /api/account/members/[userId]/reset-password
//
// Admin+ sets a new password directly for an existing member —
// no email required. This is the fix for a real production
// incident: removing a member never deletes their login (by
// design — see remove_account_member, migration 018), so
// "Criar acesso agora" always bounces off "already registered"
// for anyone re-added after a removal. This lets the admin just
// reset the existing login instead of fighting that flow, and
// works even when Supabase's outbound email is rate-limited (it
// was, in production, when this was written — see admin-client.ts
// callers for the pattern).
//
// Authorization: the target-lookup query runs through the
// caller's RLS-scoped client, so it only resolves for a profile
// in the caller's own account — cross-account access 404s the
// same as a nonexistent user, rather than leaking an authorization
// distinction. The owner row and the caller's own row are refused
// explicitly (matches PATCH/DELETE on the sibling route).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAuthAdmin } from "@/lib/auth/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MIN_PASSWORD_LEN = 6;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberResetPassword:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "Use your account settings to change your own password" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { password?: unknown }
      | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters` },
        { status: 400 },
      );
    }

    const { data: target, error: targetErr } = await ctx.supabase
      .from("profiles")
      .select("account_role")
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (targetErr) {
      console.error(
        "[POST .../reset-password] target lookup error:",
        targetErr,
      );
      return NextResponse.json(
        { error: "Failed to reset password" },
        { status: 500 },
      );
    }
    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.account_role === "owner") {
      return NextResponse.json(
        { error: "Cannot reset the owner's password this way" },
        { status: 403 },
      );
    }

    const admin = supabaseAuthAdmin();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
    });
    if (error) {
      console.error("[POST .../reset-password] updateUserById error:", error);
      return NextResponse.json(
        { error: "Failed to reset password" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
