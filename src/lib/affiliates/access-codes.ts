// One-time codes to set / reset a portal password (table aff_access_codes,
// migration 105). A "reset" code is 6 digits for 10 minutes; an "invite" is a
// long random token inside the e-mailed link, valid for 3 days. Only the
// SHA-256 hash is stored, a wrong guess is counted BEFORE comparing (5 at most)
// and a code works exactly once. Server-only (service_role).

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOtp, hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/contracts/otp";

export type AccessPurpose = "reset" | "invite";
export const INVITE_DAYS = 3;

export type AccessConsume =
  | { ok: true; purpose: AccessPurpose; restore: () => Promise<void> }
  | { ok: false; reason: "missing" | "expired" | "locked" | "wrong" | "busy"; remaining?: number };

export interface NewAccessCode {
  /** Plaintext — goes in the e-mail only. */
  code: string;
  hash: string;
  expiresAt: Date;
  purpose: AccessPurpose;
}

export function newResetCode(): NewAccessCode {
  const otp = generateOtp();
  return { code: otp.code, hash: otp.hash, expiresAt: otp.expiresAt, purpose: "reset" };
}

export function newInviteToken(now: Date = new Date()): NewAccessCode {
  const code = randomBytes(24).toString("hex");
  return { code, hash: hashOtp(code), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000), purpose: "invite" };
}

/** Persist AFTER the e-mail went out. A new code replaces the previous one for that address. */
export async function storeAccessCode(admin: SupabaseClient, email: string, c: NewAccessCode) {
  return admin.from("aff_access_codes").upsert(
    {
      email,
      purpose: c.purpose,
      code_hash: c.hash,
      expires_at: c.expiresAt.toISOString(),
      attempts: 0,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
}

export async function consumeAccessCode(admin: SupabaseClient, email: string, code: string): Promise<AccessConsume> {
  const row = await admin
    .from("aff_access_codes")
    .select("purpose, code_hash, expires_at, attempts")
    .eq("email", email)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return { ok: false, reason: "missing" };

  const { purpose, code_hash, expires_at, attempts } = row.data as {
    purpose: AccessPurpose;
    code_hash: string;
    expires_at: string;
    attempts: number;
  };
  if (new Date(expires_at) <= new Date()) {
    await admin.from("aff_access_codes").delete().eq("email", email);
    return { ok: false, reason: "expired" };
  }
  if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const counted = await admin
    .from("aff_access_codes")
    .update({ attempts: attempts + 1 })
    .eq("email", email)
    .eq("attempts", attempts)
    .select("attempts")
    .maybeSingle();
  if (counted.error) throw counted.error;
  if (!counted.data) return { ok: false, reason: "busy" };

  const given = Buffer.from(hashOtp(code), "hex");
  const stored = Buffer.from(code_hash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    return { ok: false, reason: "wrong", remaining: OTP_MAX_ATTEMPTS - (attempts + 1) };
  }

  const claimed = await admin
    .from("aff_access_codes")
    .delete()
    .eq("email", email)
    .eq("code_hash", code_hash)
    .select("email")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { ok: false, reason: "missing" };

  return {
    ok: true,
    purpose,
    restore: async () => {
      await admin.from("aff_access_codes").upsert(
        { email, purpose, code_hash, expires_at, attempts: attempts + 1, sent_at: new Date().toISOString() },
        { onConflict: "email" },
      );
    },
  };
}
