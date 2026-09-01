// ============================================================
// Contrato: transactional email (OTP codes for the "aceite virtual" flow).
//
// Reuses the same SMTP mailbox already configured for
// noreply@aureonag.com (Supabase Auth's custom SMTP) rather than adding a
// third-party provider account — see CONTRACT_SMTP_* in
// .env.local.example. `nodemailer` is the only new dependency this pulls
// in; there is no HTTP provider SDK involved.
//
// Optional, same pattern as `google-places.ts`: `isEmailConfigured()`
// lets callers degrade gracefully (the virtual-acceptance method simply
// isn't offered) instead of throwing when the env vars are unset.
// ============================================================

import nodemailer from "nodemailer";

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.CONTRACT_SMTP_HOST &&
      process.env.CONTRACT_SMTP_PORT &&
      process.env.CONTRACT_SMTP_USER &&
      process.env.CONTRACT_SMTP_PASSWORD,
  );
}

export class ContractEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractEmailError";
  }
}

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const port = Number(process.env.CONTRACT_SMTP_PORT);
  cachedTransporter = nodemailer.createTransport({
    host: process.env.CONTRACT_SMTP_HOST,
    port,
    // Port 465 is implicit TLS; everything else (587, 25) starts plain
    // and upgrades via STARTTLS — nodemailer's `secure` flag controls
    // exactly that distinction, not "whether TLS is used at all".
    secure: port === 465,
    auth: {
      user: process.env.CONTRACT_SMTP_USER,
      pass: process.env.CONTRACT_SMTP_PASSWORD,
    },
  });
  return cachedTransporter;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail({ to, subject, text, html }: SendEmailArgs): Promise<void> {
  if (!isEmailConfigured()) {
    throw new ContractEmailError("Email sending is not configured (CONTRACT_SMTP_* env vars missing).");
  }
  const from = process.env.CONTRACT_EMAIL_FROM || process.env.CONTRACT_SMTP_USER;
  try {
    await getTransporter().sendMail({ from, to, subject, text, html });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    throw new ContractEmailError(`Failed to send email: ${message}`);
  }
}
