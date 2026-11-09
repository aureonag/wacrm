// Server-only storage of each person's Meta login (meta_connections, migration
// 159). The table has RLS on and no policy, so it is reached through the
// service role only — never import this from a client component.

import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";
import { MetaAdsError } from "./meta-ads";
import { exchangeForLongLived, isRefreshDue, REFRESH_WINDOW_DAYS } from "./meta-oauth";

export interface MetaConnection {
  id: string;
  fbUserName: string | null;
  tokenExpiresAt: string | null;
  status: "connected" | "error" | "revoked";
}

export interface CompanyConnectionSummary {
  id: string;
  name: string | null;
  status: MetaConnection["status"];
}

/** Includes broken logins so the picker can reconnect the intended identity. No credentials. */
export async function listCompanyConnectionSummaries(accountId: string): Promise<CompanyConnectionSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, fb_user_name, status")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, name: (r.fb_user_name as string | null) ?? null, status: r.status as MetaConnection["status"] }));
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

export type SaveResult = { kind: "created" | "refreshed"; id: string } | { kind: "identity_conflict" };

/**
 * Stores a Meta sign-in without ever replacing another person's authorization:
 *  - the same Meta identity already stored for the company: that connection gets the
 *    new token (a reconnect), its id and the links through it stay;
 *  - a new identity: added next to the others. If the schema still allows only one
 *    connection per CRM user (migration 159) and this user already has a different
 *    one, nothing is saved and the caller is told, instead of overwriting it.
 */
export async function saveConnectionSafe(input: { accountId: string; userId: string; fbUserId: string; fbUserName: string | null; token: string; expiresAt: Date | null }): Promise<SaveResult> {
  const admin = supabaseAdmin();
  const fresh = { token_encrypted: encrypt(input.token), token_expires_at: input.expiresAt?.toISOString() ?? null, status: "connected", last_error: null, fb_user_name: input.fbUserName };

  const same = await admin.from("meta_connections").select("id").eq("account_id", input.accountId).eq("fb_user_id", input.fbUserId).maybeSingle();
  if (same.error) throw new Error(`meta_connections read failed: ${same.error.message}`);
  if (same.data) {
    const upd = await admin.from("meta_connections").update(fresh).eq("id", same.data.id as string);
    if (upd.error) throw new Error(`meta_connections save failed: ${upd.error.message}`);
    return { kind: "refreshed", id: same.data.id as string };
  }

  const ins = await admin.from("meta_connections").insert({ account_id: input.accountId, user_id: input.userId, fb_user_id: input.fbUserId, ...fresh }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return { kind: "identity_conflict" };
    throw new Error(`meta_connections save failed: ${ins.error.message}`);
  }
  return { kind: "created", id: ins.data.id as string };
}

/** The Meta identity behind a connection of this company (to insist on it when reconnecting), or null. */
export async function getConnectionIdentity(accountId: string, connectionId: string): Promise<{ id: string; fbUserId: string } | null> {
  const { data, error } = await supabaseAdmin().from("meta_connections").select("id, fb_user_id").eq("id", connectionId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  return data ? { id: data.id as string, fbUserId: data.fb_user_id as string } : null;
}

/** Marks the connection (and the ad accounts linked through it) so the team sees it needs a new sign-in. */
export async function markConnectionFailed(connectionId: string, status: "error" | "revoked", message: string): Promise<void> {
  const admin = supabaseAdmin();
  await admin.from("meta_connections").update({ status, last_error: message.slice(0, 300) }).eq("id", connectionId);
  await admin.from("ad_integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("connection_id", connectionId);
}

export interface ConnectionWithToken {
  id: string;
  fbUserName: string | null;
  tokenExpiresAt: string | null;
  token: string;
}

/**
 * Every working Meta connection of the company, with its decrypted token. The
 * company shares them: anyone in the CRM who can link ad accounts reads
 * through these, so only the people who signed in need a role on the Meta app.
 * Server-only; never return the token.
 */
export async function listCompanyConnections(accountId: string): Promise<ConnectionWithToken[]> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, fb_user_name, token_expires_at, token_encrypted")
    .eq("account_id", accountId)
    .eq("status", "connected")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  const out: ConnectionWithToken[] = [];
  for (const row of data ?? []) {
    try {
      out.push({
        id: row.id as string,
        fbUserName: (row.fb_user_name as string | null) ?? null,
        tokenExpiresAt: (row.token_expires_at as string | null) ?? null,
        token: decrypt(row.token_encrypted as string),
      });
    } catch {
      // An undecryptable row (key changed) is skipped instead of breaking the list.
      console.error("[meta_connections] could not decrypt a connection", row.id);
    }
  }
  return out;
}

/** Which of the given connection ids really belong to this company. */
export async function filterCompanyConnectionIds(accountId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin().from("meta_connections").select("id").eq("account_id", accountId).in("id", ids);
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.id as string));
}

/**
 * Renews a connection's ~60-day token when it is within the refresh window and
 * saves the new one. Returns the connection to use from now on. A failed
 * renewal keeps the old token until it really expires; a revoked login is
 * marked so the team sees it must sign in again. Server-only.
 */
export async function refreshConnectionIfDue(c: ConnectionWithToken): Promise<ConnectionWithToken> {
  if (!isRefreshDue(c.tokenExpiresAt)) return c;
  try {
    const next = await exchangeForLongLived(c.token);
    const expiresAt = next.expiresAt?.toISOString() ?? null;
    const { error } = await supabaseAdmin()
      .from("meta_connections")
      .update({ token_encrypted: encrypt(next.token), token_expires_at: expiresAt, last_error: null })
      .eq("id", c.id);
    if (error) {
      console.error("[meta_connections] could not save a renewed token", c.id, error.message);
      return c;
    }
    return { ...c, token: next.token, tokenExpiresAt: expiresAt };
  } catch (err) {
    if (err instanceof MetaAdsError && err.code === "token_invalid") await markConnectionFailed(c.id, "revoked", err.message);
    else console.error("[meta_connections] token renewal failed", c.id, err instanceof Error ? err.message : "unknown error");
    return c;
  }
}

/** Renews every working connection (all companies) that is inside the refresh window. For the scheduled route. */
export async function refreshDueConnections(): Promise<{ checked: number; refreshed: number }> {
  const limit = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, fb_user_name, token_expires_at, token_encrypted")
    .eq("status", "connected")
    .not("token_expires_at", "is", null)
    .lte("token_expires_at", limit)
    .limit(100);
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);

  let refreshed = 0;
  for (const row of data ?? []) {
    let c: ConnectionWithToken;
    try {
      c = {
        id: row.id as string,
        fbUserName: (row.fb_user_name as string | null) ?? null,
        tokenExpiresAt: (row.token_expires_at as string | null) ?? null,
        token: decrypt(row.token_encrypted as string),
      };
    } catch {
      console.error("[meta_connections] could not decrypt a connection", row.id);
      continue;
    }
    const after = await refreshConnectionIfDue(c);
    if (after.tokenExpiresAt !== c.tokenExpiresAt) refreshed++;
  }
  return { checked: data?.length ?? 0, refreshed };
}

/** One working connection of the company by id, with its token (renewed if due). Server-only. */
export async function getCompanyConnection(accountId: string, connectionId: string): Promise<ConnectionWithToken | null> {
  const { data, error } = await supabaseAdmin()
    .from("meta_connections")
    .select("id, fb_user_name, token_expires_at, token_encrypted")
    .eq("id", connectionId)
    .eq("account_id", accountId)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(`meta_connections read failed: ${error.message}`);
  if (!data) return null;
  try {
    return await refreshConnectionIfDue({
      id: data.id as string,
      fbUserName: (data.fb_user_name as string | null) ?? null,
      tokenExpiresAt: (data.token_expires_at as string | null) ?? null,
      token: decrypt(data.token_encrypted as string),
    });
  } catch {
    console.error("[meta_connections] could not decrypt a connection", connectionId);
    return null;
  }
}
