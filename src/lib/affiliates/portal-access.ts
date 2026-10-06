// Server helpers to give a portal person (affiliate or store user) access:
// finding their login, e-mailing a reset code or an invite link.
//
// Only logins created by the Afiliados module are ever touched: the lookup goes
// through aff_client_users / aff_affiliates and the auth user must carry the
// aff_portal marker — a CRM (staff) password can never be reset from here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/contracts/email";
import { portalInviteEmailHtml, portalResetEmailHtml } from "@/lib/contracts/email-templates";
import { newInviteToken, newResetCode, storeAccessCode } from "./access-codes";

export interface PortalLogin {
  /** Auth user id — null for an affiliate registered by the team who never got a login. */
  userId: string | null;
  affiliateId: string | null;
  name: string;
}

export const MIN_PASSWORD = 10;

export function normalizeEmail(v: unknown): string {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : "";
}

/** Same rule as the contracts routes: the configured site, else the forwarded host. */
export function baseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/** The login behind an e-mail: a store user first, otherwise an affiliate. */
export async function findPortalLogin(admin: SupabaseClient, email: string): Promise<PortalLogin | null> {
  const store = await admin
    .from("aff_client_users")
    .select("user_id, name")
    .ilike("email", email)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (store.data) return { userId: store.data.user_id, affiliateId: null, name: store.data.name };

  const affiliate = await admin
    .from("aff_affiliates")
    .select("id, user_id, name")
    .ilike("email", email)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (affiliate.data) return { userId: affiliate.data.user_id, affiliateId: affiliate.data.id, name: affiliate.data.name };
  return null;
}

/** True when the auth user exists AND was created by this module (aff_portal). */
export async function isPortalAuthUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  return !error && data.user?.app_metadata?.aff_portal === true;
}

/** E-mails a 6-digit reset code; stores it only after the e-mail left. Throws when the e-mail fails. */
export async function sendResetCode(admin: SupabaseClient, email: string): Promise<void> {
  const reset = newResetCode();
  await sendEmail({
    to: email,
    subject: "Código para redefinir sua senha — Aureon",
    text: `Seu código para redefinir a senha é: ${reset.code}\n\nEle expira em 10 minutos. Se você não pediu, ignore este e-mail.`,
    html: portalResetEmailHtml({ code: reset.code }),
  });
  const stored = await storeAccessCode(admin, email, reset);
  if (stored.error) throw new Error(`access code store failed: ${stored.error.message}`);
}

/** E-mails the invite link (valid 3 days, single use). Throws when the e-mail fails. */
export async function sendInvite(
  admin: SupabaseClient,
  request: Request,
  args: { email: string; name: string; store: string | null },
): Promise<void> {
  const invite = newInviteToken();
  const link = `${baseUrl(request)}/portal/definir-senha?email=${encodeURIComponent(args.email)}&code=${invite.code}`;
  await sendEmail({
    to: args.email,
    subject: "Seu acesso ao portal — Aureon",
    text: `Olá, ${args.name}.\n\nVocê recebeu acesso ao portal${args.store ? ` de ${args.store}` : ""}. Defina sua senha neste link (vale 3 dias):\n${link}\n\nSe você não esperava este convite, ignore este e-mail.`,
    html: portalInviteEmailHtml({ name: args.name, store: args.store, link }),
  });
  const stored = await storeAccessCode(admin, args.email, invite);
  if (stored.error) throw new Error(`access code store failed: ${stored.error.message}`);
}
