// POST /api/public/portal/set-password — sets the password of a portal login.
// body { email, code, password }
//   - code from "esqueci minha senha" (6 digits, 10 min) or from the invite
//     link (long token, 3 days); either way single use;
//   - an affiliate registered by the team has no login yet: an INVITE code
//     creates it (and links it to the affiliate) with the chosen password;
//   - an existing login gets the new password, but only when it was created by
//     this module (aff_portal) — a CRM staff password can never be set here.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isModuleNotReady } from "@/lib/affiliates/admin";
import { consumeAccessCode } from "@/lib/affiliates/access-codes";
import { clientIp } from "@/lib/affiliates/portal";
import { findPortalLogin, isPortalAuthUser, MIN_PASSWORD, normalizeEmail } from "@/lib/affiliates/portal-access";
import { CONSUME_MESSAGES } from "@/lib/affiliates/signup-codes";
import { createPortalUser, dropNewPortalUser, PortalUserError } from "@/lib/affiliates/store-portal";

const GENERIC = "Não foi possível definir a senha. Peça um novo código ou um novo convite.";

export async function POST(request: Request) {
  const ipLimit = checkRateLimit(`portal-setpw-ip:${clientIp(request)}`, RATE_LIMITS.portalSetPassword);
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown; password?: unknown } | null;
    const email = normalizeEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !code || code.length > 100) return NextResponse.json({ error: GENERIC }, { status: 400 });
    if (password.length < MIN_PASSWORD || password.length > 200) {
      return NextResponse.json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.` }, { status: 400 });
    }

    const emailLimit = checkRateLimit(`portal-setpw-email:${email}`, RATE_LIMITS.portalSetPassword);
    if (!emailLimit.success) return rateLimitResponse(emailLimit);

    const admin = supabaseAdmin();
    let consumed: Awaited<ReturnType<typeof consumeAccessCode>>;
    try {
      consumed = await consumeAccessCode(admin, email, code);
    } catch (err) {
      if (isModuleNotReady(err as { code?: string })) return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
      console.error("[portal/set-password] code check failed:", err);
      return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
    }
    if (!consumed.ok) {
      return NextResponse.json({ error: CONSUME_MESSAGES[consumed.reason](consumed.remaining) }, { status: 400 });
    }

    const login = await findPortalLogin(admin, email);
    if (!login) return NextResponse.json({ error: GENERIC }, { status: 400 });

    if (login.userId) {
      if (!(await isPortalAuthUser(admin, login.userId))) return NextResponse.json({ error: GENERIC }, { status: 400 });
      const updated = await admin.auth.admin.updateUserById(login.userId, { password });
      if (updated.error) {
        if (/password/i.test(updated.error.message)) {
          await consumed.restore();
          return NextResponse.json({ error: "Escolha uma senha mais forte." }, { status: 400 });
        }
        console.error("[portal/set-password] update failed:", updated.error.message);
        await consumed.restore();
        return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // An affiliate without a login yet: only an invite may create it.
    if (consumed.purpose !== "invite" || !login.affiliateId) return NextResponse.json({ error: GENERIC }, { status: 400 });
    let userId: string;
    try {
      userId = await createPortalUser(admin, { email, password, name: login.name });
    } catch (err) {
      if (err instanceof PortalUserError) {
        if (err.code === "weak_password") {
          await consumed.restore();
          return NextResponse.json({ error: "Escolha uma senha mais forte." }, { status: 400 });
        }
        if (err.code === "not_ready") return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
        if (err.code === "exists") return NextResponse.json({ error: GENERIC }, { status: 409 });
      }
      await consumed.restore();
      return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
    }
    const linked = await admin
      .from("aff_affiliates")
      .update({ user_id: userId })
      .eq("id", login.affiliateId)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (linked.error || !linked.data) {
      await dropNewPortalUser(admin, userId);
      await consumed.restore();
      return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[portal/set-password] unexpected:", err);
    return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
  }
}
