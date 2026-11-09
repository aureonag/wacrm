// Proof that an ad account is really reachable with a given Meta login, and what
// happens to the links of a connection when it signs in again. Server-only.
//
// A link is "operational" only after Meta itself described the account and an
// Insights read answered. "Sem entrega no período" (a valid answer with no row) is
// not a failure; no access and a dead token are different from each other and from a
// temporary failure.

import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { fetchAccountInsights, fetchAdAccount, MetaAdsError, type MetaAdAccount } from "./meta-ads";
import { resolvePeriod } from "./periods";

export type LinkState = "operational" | "no_delivery" | "no_access" | "token_invalid" | "failed";

export interface LinkCheck {
  state: LinkState;
  /** The account as Meta describes it; absent when it could not be read. */
  account?: MetaAdAccount;
  /** What Meta said, never a token. */
  detail?: string;
}

/** Our link states from a Meta error. Pure. */
export function stateOfError(err: unknown): LinkState {
  if (err instanceof MetaAdsError) {
    if (err.code === "token_invalid") return "token_invalid";
    if (err.code === "permission") return "no_access";
  }
  return "failed";
}

/** What ad_integrations.status / last_error should say for a check. Pure. */
export function integrationStatus(state: LinkState): { status: "connected" | "error"; lastError: string | null } {
  return state === "operational" || state === "no_delivery" ? { status: "connected", lastError: null } : { status: "error", lastError: state };
}

/**
 * Describes the account through Meta and reads its last 7 days once. Never throws for
 * Meta problems: they come back as a state.
 */
export async function checkLink(token: string, accountId: string): Promise<LinkCheck> {
  let account: MetaAdAccount;
  try {
    account = await fetchAdAccount(token, accountId);
  } catch (err) {
    return { state: stateOfError(err), detail: err instanceof MetaAdsError ? err.detail : undefined };
  }
  try {
    const range = resolvePeriod("last_7d");
    const insights = await fetchAccountInsights(token, accountId, range.since, range.until);
    return { state: insights.delivered === false ? "no_delivery" : "operational", account };
  } catch (err) {
    return { state: stateOfError(err), account, detail: err instanceof MetaAdsError ? err.detail : undefined };
  }
}

/** Only asks Meta to describe the account with this login: cheap enough for the daily health check. */
export async function checkAccess(token: string, accountId: string): Promise<LinkCheck> {
  try {
    return { state: "operational", account: await fetchAdAccount(token, accountId) };
  } catch (err) {
    return { state: stateOfError(err), detail: err instanceof MetaAdsError ? err.detail : undefined };
  }
}

/** What to save on the link after a check (status, reason and when it was proven). A check is not a sync, so last_synced_at is not touched. Pure. */
export function healthPatch(check: LinkCheck, now: Date): { status: "connected" | "error"; last_error: string | null; last_state: LinkState; last_verified_at: string } {
  const next = integrationStatus(check.state);
  return { status: next.status, last_error: next.lastError, last_state: check.state, last_verified_at: now.toISOString() };
}

/** A link that was working and no longer is: the moment worth telling someone, once. Pure. */
export function becameBroken(previousStatus: string, check: LinkCheck): boolean {
  return previousStatus === "connected" && integrationStatus(check.state).status === "error";
}

/** The notice for an ad account that stopped answering with an otherwise working login. Pure. */
export function accountDownNotice(accountName: string, state: LinkState) {
  const why = state === "no_access" ? "A conexão não tem mais acesso a ela." : state === "token_invalid" ? "A conexão expirou." : "A Meta não respondeu para ela.";
  return {
    type: "integration_down" as const,
    title: `A conta ${accountName} parou de responder`,
    body: `${why} Os relatórios e dashboards que dependem dela não conseguem ler a Meta. Veja em Reportei → Clientes → Integrações.`,
  };
}

/**
 * Checks, one by one, every account linked through a connection that is still working, and
 * saves what it finds on each link (so one account losing access does not hide behind a
 * healthy login). Returns the links that just broke, for the caller to tell someone about.
 */
export async function checkLinksOfConnection(db: ReturnType<typeof supabaseAdmin>, connectionId: string, token: string, now: Date = new Date()): Promise<{ checked: number; broken: { id: string; name: string; state: LinkState; accountId: string }[] }> {
  const { data, error } = await db.from("ad_integrations").select("id, external_account_id, external_account_name, status").eq("connection_id", connectionId).limit(500);
  if (error) throw new Error(`ad_integrations read failed: ${error.message}`);
  const broken: { id: string; name: string; state: LinkState; accountId: string }[] = [];
  for (const row of data ?? []) {
    const check = await checkAccess(token, row.external_account_id as string);
    // A temporary failure (Meta did not answer) is not an access problem: it leaves the link as it was.
    if (check.state === "failed") continue;
    const upd = await db.from("ad_integrations").update(healthPatch(check, now)).eq("id", row.id as string);
    if (upd.error) {
      console.error("[meta-link] could not save the health of a link", upd.error.message);
      continue;
    }
    if (becameBroken(row.status as string, check)) broken.push({ id: row.id as string, name: (row.external_account_name as string | null) ?? (row.external_account_id as string), state: check.state, accountId: row.external_account_id as string });
  }
  return { checked: data?.length ?? 0, broken };
}

/**
 * After a connection signs in again: every ad account linked through it is checked
 * one by one. The ones Meta now answers for go back to connected; the others stay in
 * error with the specific reason. Campaign filters, ids and reports are not touched.
 */
export async function revalidateConnectionLinks(connectionId: string, token: string): Promise<{ checked: number; recovered: number; failed: number }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("ad_integrations").select("id, external_account_id").eq("connection_id", connectionId).limit(500);
  if (error) throw new Error(`ad_integrations read failed: ${error.message}`);
  let recovered = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const check = await checkLink(token, row.external_account_id as string);
    const next = integrationStatus(check.state);
    const patch: Record<string, unknown> = { ...healthPatch(check, new Date()) };
    if (next.status === "connected") patch.last_synced_at = new Date().toISOString();
    const upd = await admin.from("ad_integrations").update(patch).eq("id", row.id as string);
    if (upd.error) console.error("[meta-link] could not update a link", upd.error.message);
    if (next.status === "connected") recovered++;
    else failed++;
  }
  return { checked: data?.length ?? 0, recovered, failed };
}
