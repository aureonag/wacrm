// ============================================================
// Contrato: one-time verification code for the "aceite virtual" flow.
//
// A 6-digit numeric code (easy to type, read over the phone if needed),
// hashed the same way as tokens elsewhere in this codebase — the
// plaintext is only ever in the email body, never persisted.
// ============================================================

import { createHash, randomInt } from "node:crypto";

/** How long a requested code stays valid. */
export const OTP_EXPIRY_MINUTES = 10;

/** Codes wrong this many times invalidate the current code — the caller must request a new one. */
export const OTP_MAX_ATTEMPTS = 5;

export interface GeneratedOtp {
  /** Plaintext 6-digit code — goes in the email body only. */
  code: string;
  /** SHA-256 hex digest — persist this in `deal_contracts.otp_code_hash`. */
  hash: string;
  expiresAt: Date;
}

export function generateOtp(now: Date = new Date()): GeneratedOtp {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return {
    code,
    hash: hashOtp(code),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000),
  };
}

export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Masks an email for display on the public page, e.g. "cli***@dominio.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}
