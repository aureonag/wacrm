// Meta Ads access for Operacional → Reportei. One system-user token (never
// expires) in META_ADS_ACCESS_TOKEN reads every ad account assigned to that
// user in Aureon's Business Manager. The token stays on the server: nothing
// here returns it, logs it, or stores it in the database.

const META_API_VERSION = "v21.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
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

export function isMetaAdsConfigured(): boolean {
  return Boolean(process.env.META_ADS_ACCESS_TOKEN);
}

/** Ad accounts the system user can see, alphabetically. */
export async function listMetaAdAccounts(): Promise<MetaAdAccount[]> {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) throw new MetaAdsError("META_ADS_ACCESS_TOKEN is not set", "not_configured");

  const first = new URL(`${META_API_BASE}/me/adaccounts`);
  first.searchParams.set("fields", "account_id,name,currency,timezone_name,account_status");
  first.searchParams.set("limit", "100");

  const out: RawAccount[] = [];
  let next: string | undefined = first.toString();
  while (next && out.length < MAX_ACCOUNTS) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Page;
    if (!res.ok || body.error) {
      const code = body.error?.code;
      if (code === 190) throw new MetaAdsError("Meta token is invalid or expired", "token_invalid");
      if (code === 10 || code === 200 || code === 294) throw new MetaAdsError("Meta token lacks permission", "permission");
      throw new MetaAdsError(`Meta request failed (${res.status}${code ? `/${code}` : ""})`, "request_failed");
    }
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }

  return parseAdAccounts(out).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
