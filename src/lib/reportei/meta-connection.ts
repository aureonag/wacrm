// Server-only storage of each person's Meta login (meta_connections, migration
// 159). The table has RLS on and no policy, so it is reached through the
// service role only — never import this from a client component.

import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

export interface MetaConnection {
  id: string;
  fbUserName: string | null;
  tokenExpiresAt: string | null;
  status: "connected" | "error" | "revoked";
}

/** Base URL the Facebook sign-in returns to: explicit config first, then the proxy's host headers. */
export function siteOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const fwdHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (fwdHost) return `${fwdProto || "https"}://${fwdHost}`;
  const host = request.headers.get("host")?.trim();
  if (host) return `${new URL(request.url).protocol.replace(":", "")}://${host}`;
  return new URL(request.url).origin;
}

export function callbackUrl(request: Request): string {
  return `${siteOrigin(request)}/api/operational/reportei/meta/callback`;
}

/** The person's connection (without the token), or null when they never signed in. */
export async function getConnection(accountId: string, userId: string): Promise<MetaConnection | null> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, fb_user_name, token_expires_at, status")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    fbUserName: (data.fb_user_name as string | null) ?? null,
    tokenExpiresAt: (data.token_expires_at as string | null) ?? null,
    status: data.status as MetaConnection["status"],
  };
}

/** The decrypted token of the person's connection, or null. Keep it on the server. */
export async function getConnectionToken(accountId: string, userId: string): Promise<{ id: string; token: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, token_encrypted")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id as string, token: decrypt(data.token_encrypted as string) };
}

export async function saveConnection(input: {
  accountId: string;
  userId: string;
  fbUserId: string;
  fbUserName: string | null;
  token: string;
  expiresAt: Date | null;
}): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .upsert(
      {
        account_id: input.accountId,
        user_id: input.userId,
        fb_user_id: input.fbUserId,
        fb_user_name: input.fbUserName,
        token_encrypted: encrypt(input.token),
        token_expires_at: input.expiresAt?.toISOString() ?? null,
        status: "connected",
        last_error: null,
      },
      { onConflict: "account_id,user_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`meta_connections save failed: ${error.message}`);
  return data.id as string;
}

/** Marks the connection (and the ad accounts linked through it) so the team sees it needs a new sign-in. */
export async function markConnectionFailed(connectionId: string, status: "error" | "revoked", message: string): Promise<void> {
  const admin = supabaseAdmin();
  await admin.from("meta_connections").update({ status, last_error: message.slice(0, 300) }).eq("id", connectionId);
  await admin.from("ad_integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("connection_id", connectionId);
}
