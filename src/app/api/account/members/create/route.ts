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
// Admin+ only. Two steps that must both succeed:
//   1. Create the auth user (fires the on_auth_user_created
//      trigger, which gives them their own personal account).
//   2. Call admin_assign_new_member() to move them into the
//      caller's account with the chosen role, deleting the
//      orphaned personal account.
//
// If step 2 fails (or throws — a dropped connection to Supabase
// counts too), step 1's user is deleted again so the admin gets a
// clean failure and can just retry, instead of a half-created
// teammate who has working credentials but isn't on the roster.
// Learned the hard way: an earlier version left step 2 unguarded,
// and a failure between the two steps silently stranded real
// invitees in their own empty personal accounts.
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

    let assignErr: { message: string } | null = null;
    try {
      const result = await ctx.supabase.rpc("admin_assign_new_member", {
        p_user_id: created.user.id,
        p_role: role,
      });
      assignErr = result.error;
    } catch (err) {
      // A thrown exception (network drop, timeout) is exactly as
      // unassigned as a returned `error` — treat both the same way
      // below rather than letting this escape to the outer catch,
      // which would skip the rollback.
      assignErr = err instanceof Error ? err : new Error(String(err));
    }

    if (assignErr) {
      console.error(
        "[POST /api/account/members/create] assign error, rolling back created user:",
        assignErr,
      );
      const { error: deleteErr } = await admin.auth.admin.deleteUser(
        created.user.id,
      );
      if (deleteErr) {
        // Now genuinely stuck in the old half-created state — this
        // is the one case worth a distinct message, since a plain
        // retry will bounce off "email already registered" without
        // explaining why.
        console.error(
          "[POST /api/account/members/create] rollback delete failed:",
          deleteErr,
        );
        return NextResponse.json(
          {
            error:
              "Account was created but could not be added to your team, and the automatic cleanup also failed. Contact support before retrying with this email.",
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "Could not create the account. Please try again." },
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
