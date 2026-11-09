// Meta Ads access for Operacional → Reportei. Each team member signs in with
// their own Facebook (see meta-oauth.ts); the long-lived token is stored
// encrypted and only ever used here, on the server, to read the ad accounts that
// person can already see. Nothing here returns, logs or exposes a token.

import type { DailyPoint } from "@/lib/reportei/report";
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
    readonly code: "not_configured" | "token_invalid" | "permission" | "request_failed" | "invalid_payload" | "invalid_filter",
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

/**
 * The list of rows of a Graph answer. Only an actual list (an empty one is a valid "nothing
 * here") counts: a missing `data`, a non-list or rows that are not objects is a bad payload,
 * never "no delivery". Pure.
 */
export function dataRows(body: unknown): Record<string, unknown>[] {
  const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new MetaAdsError("Meta answer has no data list", "invalid_payload");
  for (const row of data) if (typeof row !== "object" || row === null || Array.isArray(row)) throw new MetaAdsError("Meta answer has a row that is not an object", "invalid_payload");
  return data as Record<string, unknown>[];
}

/**
 * The "next page" link Meta sends back is followed with the access token, so it must
 * point at Graph itself: https, graph.facebook.com, a versioned path, no credentials.
 */
export function isGraphNextUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "graph.facebook.com" && !u.username && !u.password && /^\/v\d+\.\d+\//.test(u.pathname);
  } catch {
    return false;
  }
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
    out.push(...(dataRows(body) as RawAccount[]));
    next = body.paging?.next;
    if (next && !isGraphNextUrl(next)) throw new MetaAdsError("Meta returned an unexpected next page", "invalid_payload");
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

/**
 * One ad account as Meta describes it, read with the given login. This is how a
 * chosen account is proven reachable: the name, currency and time zone we keep
 * come from here, never from the browser. A 100/200/10 answer means this login
 * has no access to the account.
 */
export async function fetchAdAccount(token: string, accountId: string): Promise<MetaAdAccount> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "request_failed");
  const url = new URL(`${META_API_BASE}/${accountId}`);
  url.searchParams.set("fields", "account_id,name,currency,timezone_name,account_status");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as RawAccount & { error?: { code?: number; message?: string } };
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const kind = code === 100 ? "permission" : metaErrorKind(code);
    throw new MetaAdsError(`Meta account read failed (${res.status}${code ? `/${code}` : ""})`, kind, describeMetaError(body.error));
  }
  const [account] = parseAdAccounts([{ ...body, id: body.id ?? accountId }]);
  if (!account || account.id !== accountId) throw new MetaAdsError("Meta returned a different ad account", "invalid_payload");
  return account;
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

export interface TokenDiagnostic {
  /** From debug_token: token type, scopes, and the assets granted per scope. Never the token. */
  debug: { type?: string; expiresAt?: number; scopes?: string[]; granular?: { scope?: string; targetCount: number; targetIds: string[] }[]; error?: string };
  me: { id?: string; name?: string; error?: string };
  assignedAdAccounts: { count?: number; sample?: { id: string; name?: string }[]; error?: string };
}

/**
 * Asks Meta what a connection's token can actually see, so an admin can tell why
 * the account list is empty. Returns scopes, granted asset ids and Meta's own
 * error messages: no token, no secret.
 */
export async function diagnoseToken(token: string): Promise<TokenDiagnostic> {
  const appId = process.env.META_ADS_APP_ID;
  const appSecret = process.env.META_ADS_APP_SECRET;
  const out: TokenDiagnostic = { debug: {}, me: {}, assignedAdAccounts: {} };
  const authHeaders = { Authorization: `Bearer ${token}` };

  if (appId && appSecret) {
    const u = new URL(`${META_API_BASE}/debug_token`);
    u.searchParams.set("input_token", token);
    u.searchParams.set("access_token", `${appId}|${appSecret}`);
    const r = await fetch(u, { cache: "no-store" });
    const b = (await r.json().catch(() => ({}))) as {
      data?: { type?: string; expires_at?: number; scopes?: string[]; granular_scopes?: { scope?: string; target_ids?: unknown[] }[] };
      error?: { code?: number; message?: string };
    };
    if (b.error || !b.data) out.debug.error = describeMetaError(b.error) ?? `HTTP ${r.status}`;
    else {
      out.debug = {
        type: b.data.type,
        expiresAt: b.data.expires_at,
        scopes: b.data.scopes,
        granular: (b.data.granular_scopes ?? []).map((g) => ({
          scope: g.scope,
          targetCount: g.target_ids?.length ?? 0,
          targetIds: (g.target_ids ?? []).slice(0, 20).map(String),
        })),
      };
    }
  }

  const meUrl = new URL(`${META_API_BASE}/me`);
  meUrl.searchParams.set("fields", "id,name");
  const meRes = await fetch(meUrl, { headers: authHeaders, cache: "no-store" });
  const me = (await meRes.json().catch(() => ({}))) as { id?: string; name?: string; error?: { code?: number; message?: string } };
  if (me.error || !me.id) out.me.error = describeMetaError(me.error) ?? `HTTP ${meRes.status}`;
  else out.me = { id: me.id, name: me.name };

  if (me.id) {
    const u = new URL(`${META_API_BASE}/${me.id}/assigned_ad_accounts`);
    u.searchParams.set("fields", "account_id,name");
    u.searchParams.set("limit", "50");
    const r = await fetch(u, { headers: authHeaders, cache: "no-store" });
    const b = (await r.json().catch(() => ({}))) as { data?: { id?: string; account_id?: string; name?: string }[]; error?: { code?: number; message?: string } };
    if (b.error) out.assignedAdAccounts.error = describeMetaError(b.error);
    else {
      out.assignedAdAccounts = {
        count: b.data?.length ?? 0,
        sample: (b.data ?? []).slice(0, 10).map((a) => ({ id: a.id ?? `act_${a.account_id}`, name: a.name })),
      };
    }
  }
  return out;
}

export interface AccountInsights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  /** Leads (action `lead`) and conversations started on messaging apps, from Meta's `actions`. */
  leads?: number;
  conversations?: number;
  /** Spend per lead; 0 when there were no leads (kept for saved reports; new code uses cplOf, which is null then). */
  costPerLead?: number;
  /** False when Meta answered with no row: nothing was delivered in the period. The zeros are then real, not a failure. Absent in older snapshots. */
  delivered?: boolean;
  /** The ONE event that counted the leads (never a sum of overlapping ones); null when the account recorded none. */
  leadEvent?: string | null;
  /** The ONE purchase event used for both the quantity and the value below; null when the account recorded none. */
  purchaseEvent?: string | null;
  /** Quantity of that purchase event; null when there is none. */
  purchases?: number | null;
  /** Value of exactly the same event, in the account currency, as attributed by Meta (not revenue received); null when Meta gave no value for it. */
  purchaseValue?: number | null;
  /** How the attribution was asked and what Meta says it applied. `effective` is null when Meta did not say (unknown, not assumed). */
  attribution?: { requested: string[] | null; mode: "meta_default" | "explicit"; effective: string | null };
}

const ZERO_INSIGHTS: AccountInsights = { spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, leads: 0, conversations: 0, costPerLead: 0 };

const LEAD_ACTION = "lead";
const CONVERSATION_ACTION = "onsite_conversion.messaging_conversation_started_7d";

/** Sum of the values of one action type in Meta's `actions` list. Pure. */
export function actionTotal(actions: unknown, type: string): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (typeof a !== "object" || a === null) continue;
    const o = a as Record<string, unknown>;
    if (o.action_type !== type) continue;
    const n = Number(o.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export interface EventConfig {
  /** Exact lead event of the client (null/absent: the canonical ones, in order). */
  lead?: string | null;
  /** Exact purchase event of the client (null/absent: the canonical ones, in order). */
  purchase?: string | null;
}

export const ATTRIBUTION_WINDOWS = ["1d_click", "7d_click", "28d_click", "1d_view", "7d_view", "28d_view", "1d_ev_view"] as const;

export interface ReadOptions {
  events?: EventConfig;
  /** Attribution windows asked for explicitly (null/absent: whatever Meta applies by default). */
  attributionWindows?: readonly string[] | null;
}

/** A "non-negative finite number" out of what Meta sent; anything else is a bad payload. Pure. */
function metaNumber(v: unknown, field: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) throw new MetaAdsError("Meta insights row is malformed", "invalid_payload", `invalid ${field}`);
  return n;
}

export interface ActionEntry {
  type: string;
  value: number;
}

/** Meta's `actions` / `action_values`: absent = null; present but not a list of {action_type, numeric value} = bad payload. Pure. */
export function readActions(v: unknown, field: string): ActionEntry[] | null {
  if (v === undefined) return null;
  if (!Array.isArray(v)) throw new MetaAdsError("Meta insights row is malformed", "invalid_payload", `${field} is not a list`);
  return v.map((a) => {
    if (typeof a !== "object" || a === null || typeof (a as Record<string, unknown>).action_type !== "string") throw new MetaAdsError("Meta insights row is malformed", "invalid_payload", `bad entry in ${field}`);
    return { type: (a as Record<string, unknown>).action_type as string, value: metaNumber((a as Record<string, unknown>).value, `${field} value`) };
  });
}

/** The first candidate event that the row carries (the one that counts); null when none. Pure. */
export function chooseEvent(actions: readonly ActionEntry[] | null, candidates: readonly string[]): string | null {
  if (!actions) return null;
  return candidates.find((type) => actions.some((a) => a.type === type)) ?? null;
}

/** Sum of the entries of exactly one event type (null when the list is absent or has no such entry). Pure. */
export function eventTotal(list: readonly ActionEntry[] | null, type: string | null): number | null {
  if (!list || !type) return null;
  const hits = list.filter((a) => a.type === type);
  return hits.length === 0 ? null : hits.reduce((acc, a) => acc + a.value, 0);
}

/** Canonical events, in order of preference. A client can pin one exact event instead (reportei_client_settings). */
export const LEAD_EVENTS = ["lead", "offsite_conversion.fb_pixel_lead"] as const;
export const PURCHASE_EVENTS = ["purchase", "offsite_conversion.fb_pixel_purchase"] as const;

/** Spend per lead, or null when there is no base (no leads). Never a zero that looks like a great cost. Pure. */
export function cplOf(spend: number, leads: number | null | undefined): number | null {
  return typeof leads === "number" && leads > 0 && Number.isFinite(spend) ? Math.round((spend / leads) * 100) / 100 : null;
}

const REQUIRED_NUMERIC = ["spend", "impressions", "clicks"] as const;
const OPTIONAL_NUMERIC = ["reach", "ctr", "cpc", "cpm"] as const;

/**
 * A strict read of an Insights answer. No row = nothing delivered (delivered:false, real
 * zeros), and only a valid answer with an empty list gets here. A row whose basic numbers
 * are missing, negative or not numeric, or whose actions are malformed, is a bad payload and
 * throws: it is never turned into zeros. Leads and purchases come from ONE event each, and the
 * purchase value is read from that same event, so a quantity of one event is never paired with
 * the value of another. The chosen events are kept in the result. Pure.
 */
export function parseInsightsStrict(row: Record<string, unknown> | undefined, options: ReadOptions = {}): AccountInsights {
  const requested = options.attributionWindows && options.attributionWindows.length > 0 ? [...options.attributionWindows] : null;
  const attribution = (effective: string | null): AccountInsights["attribution"] => ({ requested, mode: requested ? "explicit" : "meta_default", effective });
  if (!row) return { ...ZERO_INSIGHTS, delivered: false, leadEvent: null, purchaseEvent: null, purchases: null, purchaseValue: null, attribution: attribution(null) };

  const numbers: Record<string, number> = {};
  for (const key of REQUIRED_NUMERIC) numbers[key] = metaNumber(row[key], key);
  for (const key of OPTIONAL_NUMERIC) numbers[key] = row[key] === undefined ? 0 : metaNumber(row[key], key);

  const actions = readActions(row.actions, "actions");
  const values = readActions(row.action_values, "action_values");
  const leadEvent = chooseEvent(actions, options.events?.lead ? [options.events.lead] : LEAD_EVENTS);
  const purchaseEvent = chooseEvent(actions, options.events?.purchase ? [options.events.purchase] : PURCHASE_EVENTS);
  const leads = eventTotal(actions, leadEvent) ?? 0;
  const effective = typeof row.attribution_setting === "string" && row.attribution_setting.trim() ? row.attribution_setting.trim().slice(0, 100) : null;
  return {
    spend: numbers.spend,
    impressions: numbers.impressions,
    reach: numbers.reach,
    clicks: numbers.clicks,
    ctr: numbers.ctr,
    cpc: numbers.cpc,
    cpm: numbers.cpm,
    leads,
    conversations: eventTotal(actions, CONVERSATION_ACTION) ?? 0,
    costPerLead: leads > 0 ? Math.round((numbers.spend / leads) * 100) / 100 : 0,
    delivered: true,
    leadEvent,
    purchaseEvent,
    purchases: eventTotal(actions, purchaseEvent),
    // The value of exactly that event: another type's value is never borrowed.
    purchaseValue: eventTotal(values, purchaseEvent),
    attribution: attribution(effective),
  };
}

/** One Insights row (Meta sends every number as a string) to numbers. No row means no delivery in the period: all zeros. Pure. */
export function parseInsights(row: Record<string, unknown> | undefined): AccountInsights {
  if (!row) return { ...ZERO_INSIGHTS };
  const n = (v: unknown) => {
    const x = typeof v === "string" || typeof v === "number" ? Number(v) : 0;
    return Number.isFinite(x) ? x : 0;
  };
  const spend = n(row.spend);
  const leads = actionTotal(row.actions, LEAD_ACTION);
  return {
    spend,
    impressions: n(row.impressions),
    reach: n(row.reach),
    clicks: n(row.clicks),
    ctr: n(row.ctr),
    cpc: n(row.cpc),
    cpm: n(row.cpm),
    leads,
    conversations: actionTotal(row.actions, CONVERSATION_ACTION),
    costPerLead: leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0,
  };
}

/**
 * Limits an Insights read to some campaigns of the account. null/undefined = the whole account.
 * A list must be non-empty and made of campaign ids (digits only): anything else is refused,
 * never dropped, so a bad filter cannot silently widen the read to the whole account. Pure.
 */
export function campaignFilterParam(campaignIds: readonly string[] | null | undefined): string | null {
  if (campaignIds === null || campaignIds === undefined) return null;
  if (!Array.isArray(campaignIds) || campaignIds.length === 0 || campaignIds.length > 500 || !campaignIds.every((id) => typeof id === "string" && /^\d{1,30}$/.test(id))) {
    throw new MetaAdsError("Invalid campaign filter", "invalid_filter");
  }
  return JSON.stringify([{ field: "campaign.id", operator: "IN", value: [...new Set(campaignIds)] }]);
}

function filterCampaigns(url: URL, campaignIds: readonly string[] | null | undefined): void {
  const param = campaignFilterParam(campaignIds);
  if (param) url.searchParams.set("filtering", param);
}

/** Account-level totals for a period (`since`/`until` as YYYY-MM-DD), read with ads_read. */
export async function fetchAccountInsights(token: string, accountId: string, since: string, until: string, campaignIds?: readonly string[] | null, options: ReadOptions = {}): Promise<AccountInsights> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "request_failed");
  const url = new URL(`${META_API_BASE}/${accountId}/insights`);
  url.searchParams.set("fields", "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,attribution_setting");
  const windows = options.attributionWindows && options.attributionWindows.length > 0 ? options.attributionWindows : null;
  if (windows) {
    if (!windows.every((w) => (ATTRIBUTION_WINDOWS as readonly string[]).includes(w))) throw new MetaAdsError("Invalid attribution window", "invalid_filter");
    url.searchParams.set("action_attribution_windows", JSON.stringify(windows));
  }
  filterCampaigns(url, campaignIds);
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("level", "account");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; error?: { code?: number; message?: string } };
  if (!res.ok || body.error) {
    throw new MetaAdsError(`Meta insights failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, metaErrorKind(body.error?.code), describeMetaError(body.error));
  }
  const rows = dataRows(body);
  // Account level, one period: one row at most. More than one is not an answer we understand.
  if (rows.length > 1) throw new MetaAdsError("Meta returned several rows for one period", "invalid_payload");
  return parseInsightsStrict(rows[0], options);
}

export interface DayRow {
  date: string;
  spend: number;
  /** Null when the account recorded no lead event that day (not measured), a number otherwise. */
  leads: number | null;
  purchaseValue: number | null;
}

/** Day rows (time_increment=1) with spend, leads and purchase value. A row without a valid date, a non-numeric spend or malformed actions is a bad payload. Pure. */
export function parseDayRows(rows: Record<string, unknown>[] | undefined, events: EventConfig = {}): DayRow[] {
  const out: DayRow[] = [];
  for (const row of rows ?? []) {
    const date = row.date_start;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new MetaAdsError("Meta daily row has no valid date", "invalid_payload");
    const spend = metaNumber(row.spend, "spend");
    const actions = readActions(row.actions, "actions");
    const values = readActions(row.action_values, "action_values");
    const leadEvent = chooseEvent(actions, events.lead ? [events.lead] : LEAD_EVENTS);
    const purchaseEvent = chooseEvent(actions, events.purchase ? [events.purchase] : PURCHASE_EVENTS);
    out.push({ date, spend, leads: eventTotal(actions, leadEvent), purchaseValue: eventTotal(values, purchaseEvent) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Day by day spend, leads and purchase value of an account, following every page of results. Days Meta did not return are not invented. */
export async function fetchDayRows(token: string, accountId: string, since: string, until: string, campaignIds?: readonly string[] | null, options: ReadOptions = {}): Promise<DayRow[]> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "request_failed");
  const first = new URL(`${META_API_BASE}/${accountId}/insights`);
  first.searchParams.set("fields", "spend,actions,action_values");
  const windows = options.attributionWindows && options.attributionWindows.length > 0 ? options.attributionWindows : null;
  if (windows) {
    if (!windows.every((w) => (ATTRIBUTION_WINDOWS as readonly string[]).includes(w))) throw new MetaAdsError("Invalid attribution window", "invalid_filter");
    first.searchParams.set("action_attribution_windows", JSON.stringify(windows));
  }
  filterCampaigns(first, campaignIds);
  first.searchParams.set("time_range", JSON.stringify({ since, until }));
  first.searchParams.set("time_increment", "1");
  first.searchParams.set("level", "account");
  first.searchParams.set("limit", "100");
  const rows: Record<string, unknown>[] = [];
  let next: string | undefined = first.toString();
  let pages = 0;
  while (next) {
    if (++pages > 20) throw new MetaAdsError("Too many pages of daily insights", "invalid_payload");
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      throw new MetaAdsError(`Meta daily insights failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, metaErrorKind(body.error?.code), describeMetaError(body.error));
    }
    rows.push(...dataRows(body));
    next = body.paging?.next;
    if (next && !isGraphNextUrl(next)) throw new MetaAdsError("Meta returned an unexpected next page", "invalid_payload");
  }
  return parseDayRows(rows, options.events);
}

/** Insights rows broken down by day (`time_increment=1`) to points. A row without a valid date or with broken numbers is a bad payload, not a day to skip. Pure. */
export function parseDaily(rows: Record<string, unknown>[] | undefined): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (const row of rows ?? []) {
    const date = row.date_start;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new MetaAdsError("Meta daily row has no valid date", "invalid_payload");
    const { spend, impressions, reach, clicks } = parseInsightsStrict(row);
    out.push({ date, spend, impressions, reach, clicks });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Account-level numbers day by day for a period (at most 366 rows, so one page). */
export async function fetchDailyInsights(token: string, accountId: string, since: string, until: string, campaignIds?: readonly string[] | null): Promise<DailyPoint[]> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "request_failed");
  const url = new URL(`${META_API_BASE}/${accountId}/insights`);
  url.searchParams.set("fields", "spend,impressions,reach,clicks");
  filterCampaigns(url, campaignIds);
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("level", "account");
  url.searchParams.set("limit", "400");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; error?: { code?: number; message?: string } };
  if (!res.ok || body.error) {
    throw new MetaAdsError(`Meta daily insights failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, metaErrorKind(body.error?.code), describeMetaError(body.error));
  }
  return parseDaily(dataRows(body));
}

export interface MetaCampaign {
  id: string;
  name: string;
  /** Meta's effective_status (ACTIVE, PAUSED, ARCHIVED, ...). */
  status: string;
}

/** Campaign rows from Meta to our shape. Rows without a numeric id are dropped. Pure. */
export function parseCampaigns(rows: Record<string, unknown>[] | undefined): MetaCampaign[] {
  const out: MetaCampaign[] = [];
  for (const row of rows ?? []) {
    if (typeof row.id !== "string" || !/^\d+$/.test(row.id)) continue;
    out.push({
      id: row.id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id,
      status: typeof row.effective_status === "string" ? row.effective_status : "",
    });
  }
  return out;
}

/** Campaigns of an ad account (up to 1000), read with ads_read. */
export async function listCampaigns(token: string, accountId: string): Promise<MetaCampaign[]> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "request_failed");
  const first = new URL(`${META_API_BASE}/${accountId}/campaigns`);
  first.searchParams.set("fields", "id,name,effective_status");
  first.searchParams.set("limit", "200");
  const rows: Record<string, unknown>[] = [];
  let next: string | undefined = first.toString();
  while (next && rows.length < 1000) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      throw new MetaAdsError(`Meta campaigns failed (${res.status}${body.error?.code ? `/${body.error.code}` : ""})`, metaErrorKind(body.error?.code), describeMetaError(body.error));
    }
    rows.push(...dataRows(body));
    next = body.paging?.next;
    if (next && !isGraphNextUrl(next)) throw new MetaAdsError("Meta returned an unexpected next page", "invalid_payload");
  }
  return parseCampaigns(rows);
}
