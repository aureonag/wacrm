// POST /api/public/affiliates/register/send-code — e-mails a 6-digit
// confirmation code to the address the person typed in the sign-up form.
//
// No auth. The e-mail goes out FIRST and the code is stored only after a
// successful send (a failed send never leaves a valid-but-undelivered code).
// Tight rate limits, per IP and per address, because each success mails a real
// inbox. If the address already belongs to an affiliate nothing is sent but the
// answer is identical (no way to probe which e-mails are registered).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { isEmailConfigured, sendEmail } from "@/lib/contracts/email";
import { affiliateOtpEmailHtml } from "@/lib/contracts/email-templates";
import { maskEmail } from "@/lib/contracts/otp";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { BadInput } from "@/lib/affiliates/campaigns";
import { isModuleNotReady } from "@/lib/affiliates/admin";
import { clientIp, isPortalReady, portalNotReadyResponse } from "@/lib/affiliates/portal";
import { parseSendCodeInput } from "@/lib/affiliates/registration";
import { newSignupCode, storeSignupCode } from "@/lib/affiliates/signup-codes";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function POST(request: Request) {
  const ipLimit = checkRateLimit(`aff-code-ip:${clientIp(request)}`, RATE_LIMITS.affiliateSendCode);
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  try {
    const input = parseSendCodeInput(await request.json().catch(() => null));
    const emailLimit = checkRateLimit(`aff-code-email:${input.email}`, RATE_LIMITS.affiliateSendCode);
    if (!emailLimit.success) return rateLimitResponse(emailLimit);

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "O envio de e-mail ainda não está configurado neste ambiente." }, { status: 503 });
    }

    const admin = supabaseAdmin();
    if (!(await isPortalReady(admin))) return portalNotReadyResponse();

    const found = await admin
      .from("aff_campaigns")
      .select("id, name, status, end_date, aff_clients(name, status)")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (found.error) return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
    const campaign = found.data as unknown as {
      id: string;
      name: string;
      status: string;
      end_date: string | null;
      aff_clients: { name: string; status: string } | null;
    } | null;
    if (!campaign || campaign.aff_clients?.status !== "active") {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }
    if (campaign.status !== "active" || (campaign.end_date && today() > campaign.end_date)) {
      return NextResponse.json({ error: "Esta campanha não está recebendo novas inscrições." }, { status: 409 });
    }

    const masked = maskEmail(input.email);
    const existing = await admin.from("aff_affiliates").select("id").eq("email", input.email).maybeSingle();
    if (existing.error) return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
    if (existing.data) return NextResponse.json({ ok: true, email_masked: masked });

    const otp = newSignupCode();
    try {
      await sendEmail({
        to: input.email,
        subject: "Código de confirmação — Aureon",
        text: `Seu código de confirmação é: ${otp.code}\n\nUse-o para concluir sua inscrição na campanha ${campaign.name} (${campaign.aff_clients.name}). Este código expira em 10 minutos.`,
        html: affiliateOtpEmailHtml({ code: otp.code, store: campaign.aff_clients.name, campaign: campaign.name }),
      });
    } catch (err) {
      console.error("[affiliates/send-code] email error:", err);
      return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
    }

    const stored = await storeSignupCode(admin, input.email, campaign.id, otp);
    if (stored.error) {
      if (isModuleNotReady(stored.error)) return portalNotReadyResponse();
      console.error("[affiliates/send-code] store failed:", stored.error.message);
      return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email_masked: masked });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[affiliates/send-code] unexpected:", err);
    return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
  }
}
