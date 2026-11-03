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
      throw new MetaAdsError(`Meta request failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, kind);
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
