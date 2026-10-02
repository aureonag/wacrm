// E-mail confirmation codes for the public affiliate sign-up (table
// aff_signup_codes, migration 103). Same rules as the contracts' virtual
// acceptance: 6 digits, only the SHA-256 hash is stored, 10 minutes, at most
// 5 wrong attempts, single use. Server-only (service_role).

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOtp, hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/contracts/otp";

export type ConsumeResult =
  | { ok: true; restore: () => Promise<void> }
  | { ok: false; reason: "missing" | "expired" | "locked" | "wrong" | "busy"; remaining?: number };

export const CONSUME_MESSAGES: Record<Exclude<ConsumeResult, { ok: true }>["reason"], (remaining?: number) => string> = {
  missing: () => "Código não encontrado. Solicite um novo código.",
  expired: () => "O código expirou. Solicite um novo código.",
  locked: () => "Muitas tentativas incorretas. Solicite um novo código.",
  wrong: (n) => `Código incorreto. ${n === 1 ? "Resta 1 tentativa." : `Restam ${n ?? 0} tentativas.`}`,
  busy: () => "Não foi possível validar o código agora. Tente novamente.",
};

/** Generates a code (plaintext only for the e-mail body) — persist with storeSignupCode AFTER the e-mail went out. */
export function newSignupCode() {
  return generateOtp();
}

export async function storeSignupCode(
  admin: SupabaseClient,
  email: string,
  campaignId: string,
  otp: { hash: string; expiresAt: Date },
) {
  return admin.from("aff_signup_codes").upsert(
    {
      email,
      campaign_id: campaignId,
      code_hash: otp.hash,
      expires_at: otp.expiresAt.toISOString(),
      attempts: 0,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "email,campaign_id" },
  );
}

/**
 * Checks the code and, when right, consumes it (so it works exactly once).
 * `restore` puts it back if a later step fails for a reason the person can
 * fix without a new e-mail (e.g. a rejected password).
 */
export async function consumeSignupCode(
  admin: SupabaseClient,
  email: string,
  campaignId: string,
  code: string,
): Promise<ConsumeResult> {
  const row = await admin
    .from("aff_signup_codes")
    .select("code_hash, expires_at, attempts")
    .eq("email", email)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return { ok: false, reason: "missing" };

  const { code_hash, expires_at, attempts } = row.data as { code_hash: string; expires_at: string; attempts: number };
  if (new Date(expires_at) <= new Date()) {
    await admin.from("aff_signup_codes").delete().eq("email", email).eq("campaign_id", campaignId);
    return { ok: false, reason: "expired" };
  }
  if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  // Count the attempt BEFORE comparing; the `attempts` guard makes parallel
  // guesses race on the same counter instead of all getting a free try.
  const counted = await admin
    .from("aff_signup_codes")
    .update({ attempts: attempts + 1 })
    .eq("email", email)
    .eq("campaign_id", campaignId)
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
    .from("aff_signup_codes")
    .delete()
    .eq("email", email)
    .eq("campaign_id", campaignId)
    .eq("code_hash", code_hash)
    .select("email")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { ok: false, reason: "missing" };

  return {
    ok: true,
    restore: async () => {
      await admin.from("aff_signup_codes").upsert(
        { email, campaign_id: campaignId, code_hash, expires_at, attempts: attempts + 1, sent_at: new Date().toISOString() },
        { onConflict: "email,campaign_id" },
      );
    },
  };
}
