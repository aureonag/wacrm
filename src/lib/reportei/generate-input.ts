// The integrations a new report is asked for (body of POST /reports/generate), checked.

import { CATALOG_NETWORKS } from "./doc-catalog";
import type { Integration } from "./doc-templates";

const MAX_INTEGRATIONS = 20;

export type ParsedIntegration = Integration & {
  /** The linked ad account (act_…) the server uses to pick the account; null for networks without a real source. */
  accountId: string | null;
  /** Null = the whole account; otherwise a non-empty list of campaign ids. */
  campaigns: string[] | null;
};

/**
 * The integrations of the body, or null when anything in them is invalid. Nothing is dropped
 * or defaulted: a bad campaign filter in particular makes the request invalid, it never turns
 * into "the whole account". The `account` text is only a label (it never selects an account).
 */
export function parseIntegrations(input: unknown): ParsedIntegration[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_INTEGRATIONS) return null;
  const out: ParsedIntegration[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const { network, account, accountId, campaigns } = raw as Record<string, unknown>;
    if (typeof network !== "string" || !CATALOG_NETWORKS.includes(network)) return null;
    if (typeof account !== "string" || !account.trim() || account.length > 200) return null;
    if (accountId !== undefined && accountId !== null && (typeof accountId !== "string" || !/^act_\d{1,30}$/.test(accountId))) return null;
    let picked: string[] | null = null;
    if (campaigns !== undefined && campaigns !== null) {
      if (!Array.isArray(campaigns) || campaigns.length === 0 || campaigns.length > 500 || !campaigns.every((c) => typeof c === "string" && /^\d{1,30}$/.test(c))) return null;
      picked = [...new Set(campaigns as string[])];
    }
    out.push({ network, account: account.trim(), accountId: (accountId as string | null | undefined) ?? null, campaigns: picked });
  }
  return out;
}
