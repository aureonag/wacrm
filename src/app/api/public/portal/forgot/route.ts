// POST /api/public/portal/forgot — "esqueci minha senha" of the portal.
// body { email } → e-mails a 6-digit code (10 minutes) IF that address belongs
// to a portal login. The answer is always the same ({ ok: true }) so nobody can
// probe which e-mails are registered. Tight limits per IP and per address
// because each success mails a real inbox.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { isEmailConfigured } from "@/lib/contracts/email";
import { maskEmail } from "@/lib/contracts/otp";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isModuleNotReady } from "@/lib/affiliates/admin";
import { clientIp } from "@/lib/affiliates/portal";
import { findPortalLogin, isPortalAuthUser, normalizeEmail, sendResetCode } from "@/lib/affiliates/portal-access";

export async function POST(request: Request) {
  const ipLimit = checkRateLimit(`portal-code-ip:${clientIp(request)}`, RATE_LIMITS.portalAccessCode);
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = normalizeEmail(body?.email);
    if (!email) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });

    const emailLimit = checkRateLimit(`portal-code-email:${email}`, RATE_LIMITS.portalAccessCode);
    if (!emailLimit.success) return rateLimitResponse(emailLimit);

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "O envio de e-mail ainda não está configurado neste ambiente." }, { status: 503 });
    }

    const admin = supabaseAdmin();
    const login = await findPortalLogin(admin, email);
    if (login?.userId && (await isPortalAuthUser(admin, login.userId))) {
      try {
        await sendResetCode(admin, email);
      } catch (err) {
        if (isModuleNotReady((err as { code?: string })) || /aff_access_codes/.test(String((err as Error)?.message))) {
          return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
        }
        console.error("[portal/forgot] send failed:", err);
        return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
      }
    }
    return NextResponse.json({ ok: true, email_masked: maskEmail(email) });
  } catch (err) {
    console.error("[portal/forgot] unexpected:", err);
    return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
  }
}
