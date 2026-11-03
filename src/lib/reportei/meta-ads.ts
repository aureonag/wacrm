// Meta Ads access for Operacional → Reportei. Each team member signs in with
// their own Facebook (see meta-oauth.ts); the long-lived token is stored
// encrypted and only ever used here, on the server, to read the ad accounts that
// person can already see. Nothing here returns, logs or exposes a token.

export const META_API_VERSION = "v21.0";
export const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const MAX_ACCOUNTS = 500;

export interface MetaAdAccount {
  /** "act_123…" — what the Marketing API calls the account. */
  id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  /** Meta's numeric account_status (1 = active). */
  status: number | null;
}

export class MetaAdsError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "token_invalid" | "permission" | "request_failed",
    /** What Meta said (code and message, never a token), so an admin can see why it failed. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

interface RawAccount {
  account_id?: string;
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

/** One short line from Meta's error object: "(#200) message". Pure. */
export function describeMetaError(e: { code?: number; message?: string } | undefined): string | undefined {
  if (!e) return undefined;
  const text = [e.code !== undefined ? `#${e.code}` : null, e.message].filter(Boolean).join(" ");
  return text ? text.slice(0, 300) : undefined;
}

interface Page {
  data?: RawAccount[];
  paging?: { next?: string };
  error?: { code?: number; message?: string };
}

/** Maps Meta's page payload to our shape. Pure, so it can be tested without the network. */
export function parseAdAccounts(raw: RawAccount[]): MetaAdAccount[] {
  return raw
    .map((a) => {
      const id = a.id ?? (a.account_id ? `act_${a.account_id}` : "");
      return {
        id,
        name: a.name?.trim() || id,
        currency: a.currency ?? null,
        timezone: a.timezone_name ?? null,
        status: typeof a.account_status === "number" ? a.account_status : null,
      };
    })
    .filter((a) => a.id !== "");
}

/** Maps a Graph API error code to our error kind. 190 = token invalid/expired; 10/200/294 = missing permission. */
export function metaErrorKind(code: number | undefined): "token_invalid" | "permission" | "request_failed" {
  if (code === 190) return "token_invalid";
  if (code === 10 || code === 200 || code === 294) return "permission";
  return "request_failed";
}

/** Ad accounts the given person's token can see, alphabetically. */
export async function listMetaAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const first = new URL(`${META_API_BASE}/me/adaccounts`);
  first.searchParams.set("fields", "account_id,name,currency,timezone_name,account_status");
  first.searchParams.set("limit", "100");

  const out: RawAccount[] = [];
  let next: string | undefined = first.toString();
  while (next && out.length < MAX_ACCOUNTS) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Page;
    if (!res.ok || body.error) {
      const kind = metaErrorKind(body.error?.code);
      throw new MetaAdsError(`Meta request failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, kind, describeMetaError(body.error));
    }
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }

  return parseAdAccounts(out).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface MetaAdAccountWithConnection extends MetaAdAccount {
  /** The company connection (meta_connections.id) whose login can read this account. */
  connectionId: string;
}

/**
 * Joins the accounts each connection can see into one list. An account that two
 * connections both see is listed once, under the first connection. Pure.
 */
export function mergeConnectionAccounts(lists: { connectionId: string; accounts: MetaAdAccount[] }[]): MetaAdAccountWithConnection[] {
  const seen = new Map<string, MetaAdAccountWithConnection>();
  for (const { connectionId, accounts } of lists) {
    for (const a of accounts) if (!seen.has(a.id)) seen.set(a.id, { ...a, connectionId });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

interface DebugTokenResponse {
  data?: { granular_scopes?: { scope?: string; target_ids?: unknown[] }[] };
  error?: { code?: number; message?: string };
}

/**
 * The ad accounts a Facebook-Login-for-Business token was granted: the assets
 * picked at sign-in are recorded in debug_token's granular_scopes, under
 * ads_read (or ads_management). Always returned as "act_<id>". Pure.
 */
export function grantedAdAccountIds(debug: DebugTokenResponse): string[] {
  const ids = new Set<string>();
  for (const s of debug.data?.granular_scopes ?? []) {
    if (s.scope !== "ads_read" && s.scope !== "ads_management") continue;
    for (const raw of s.target_ids ?? []) {
      const id = String(raw);
      if (/^(act_)?\d+$/.test(id)) ids.add(id.startsWith("act_") ? id : `act_${id}`);
    }
  }
  return [...ids];
}

const MAX_GRANTED = 50;

/**
 * Accounts the token was granted at sign-in. A system-user token (the "Nunca
 * expira" configuration) cannot list /me/adaccounts, but it can read each ad
 * account it was given, so we ask Meta which ones (debug_token, with the app's
 * own credentials) and read their details one by one.
 */
export async function listGrantedAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const appId = process.env.META_ADS_APP_ID;
  const appSecret = process.env.META_ADS_APP_SECRET;
  if (!appId || !appSecret) throw new MetaAdsError("Meta app is not configured", "not_configured");

  const dbg = new URL(`${META_API_BASE}/debug_token`);
  dbg.searchParams.set("input_token", token);
  dbg.searchParams.set("access_token", `${appId}|${appSecret}`);
  const dbgRes = await fetch(dbg, { cache: "no-store" });
  const dbgBody = (await dbgRes.json().catch(() => ({}))) as DebugTokenResponse;
  if (!dbgRes.ok || dbgBody.error) {
    throw new MetaAdsError(`Meta debug_token failed (${dbgRes.status})`, metaErrorKind(dbgBody.error?.code), describeMetaError(dbgBody.error));
  }

  const ids = grantedAdAccountIds(dbgBody).slice(0, MAX_GRANTED);
  const raw: RawAccount[] = [];
  let firstError: MetaAdsError | null = null;
  for (const id of ids) {
    const url = new URL(`${META_API_BASE}/${id}`);
    url.searchParams.set("fields", "account_id,name,currency,timezone_name,account_status");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as RawAccount & { error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      firstError ??= new MetaAdsError(`Meta account read failed (${res.status})`, metaErrorKind(body.error?.code), describeMetaError(body.error));
      continue;
    }
    raw.push({ ...body, id: body.id ?? id });
  }
  // Granted accounts exist but none could be read: surface why instead of an empty list.
  if (ids.length > 0 && raw.length === 0 && firstError) throw firstError;
  return parseAdAccounts(raw).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** The accounts one connection can read: the normal listing, or the granted assets when Meta refuses that listing with a permission error. */
export async function listConnectionAdAccounts(token: string): Promise<MetaAdAccount[]> {
  try {
    return await listMetaAdAccounts(token);
  } catch (err) {
    if (err instanceof MetaAdsError && err.code === "permission") return listGrantedAdAccounts(token);
    throw err;
  }
}
