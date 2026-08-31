// ============================================================
// POST /api/account/members/create
//
// "Criar acesso agora" — the admin sets an email + password
// directly instead of generating a shareable invite link. Unlike
// /api/account/invitations, this creates the auth user
// synchronously (via the service-role Admin API) with
// `email_confirm: true`, so the new teammate can log in
// immediately with the credentials the admin hands them —
// no self-signup, no email confirmation round trip.
//
// Admin+ only. Two-step, best-effort atomic:
//   1. Create the auth user (fires the on_auth_user_created
//      trigger, which gives them their own personal account).
//   2. Call admin_assign_new_member() to move them into the
//      caller's account with the chosen role, deleting the
//      orphaned personal account.
//
// If step 2 fails after step 1 succeeds, the new auth user is
// left with their own empty personal account rather than being
// added to the caller's — not fully atomic, but the same caveat
// already exists on the invite-redemption path (019) and a failed
// assignment surfaces as a clear error the admin can act on
// (e.g. retry is blocked by "email already registered", which is
// itself informative).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAuthAdmin } from "@/lib/auth/admin-client";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MIN_PASSWORD_LEN = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Same cap as invite creation — this is a clicks-only UI, the
    // limit exists to bound abuse, not normal admin use.
    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          email?: unknown;
          password?: unknown;
          fullName?: unknown;
          role?: unknown;
        }
      | null;

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const fullName =
      typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const role = body?.role;

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "A valid email is required" },
        { status: 400 },
      );
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters` },
        { status: 400 },
      );
    }
    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    const admin = supabaseAuthAdmin();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (createErr || !created?.user) {
      const message = createErr?.message ?? "Failed to create user";
      // Supabase surfaces a distinct message for a duplicate email;
      // map to 409 so the client can show a targeted error instead
      // of a generic 500.
      const status = /already|registered|exists/i.test(message) ? 409 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    const { error: assignErr } = await ctx.supabase.rpc(
      "admin_assign_new_member",
      { p_user_id: created.user.id, p_role: role },
    );

    if (assignErr) {
      console.error(
        "[POST /api/account/members/create] assign error:",
        assignErr,
      );
      return NextResponse.json(
        {
          error:
            "Account was created but could not be added to your team. Contact support.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { userId: created.user.id, email, role },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
