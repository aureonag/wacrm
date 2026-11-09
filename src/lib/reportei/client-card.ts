// What a client card of Reportei → Clientes shows: the networks linked, how
// healthy the connections are, how many reports and when the last one was made,
// plus the client's logo. Pure; the route gathers the rows.

export const LOGO_BUCKET = "avatars";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export type Health = "ok" | "attention" | "none";

export interface ClientCardData {
  id: string;
  name: string;
  code: string | null;
  status: "active" | "inactive";
  logoUrl: string | null;
  /** Networks with at least one linked account, e.g. ["meta_ads"]. */
  networks: string[];
  health: Health;
  reportCount: number;
  lastReportAt: string | null;
}

/** "none" without integrations, "attention" if any is not connected, otherwise "ok". */
export function healthOf(statuses: readonly string[]): Health {
  if (statuses.length === 0) return "none";
  return statuses.every((s) => s === "connected") ? "ok" : "attention";
}

/** Distinct networks in a stable order. */
export function networksOf(providers: readonly string[]): string[] {
  return [...new Set(providers)].sort();
}

export interface ReportStats {
  count: number;
  last: string | null;
}

/** Report count and newest creation date per client, from raw rows. */
export function reportStatsByClient(rows: readonly { client_id: string; created_at: string }[]): Map<string, ReportStats> {
  const out = new Map<string, ReportStats>();
  for (const r of rows) {
    const cur = out.get(r.client_id) ?? { count: 0, last: null };
    cur.count++;
    if (!cur.last || r.created_at > cur.last) cur.last = r.created_at;
    out.set(r.client_id, cur);
  }
  return out;
}

/** Storage path of a client's new logo. */
export function logoPath(clientId: string, ext: string, now = Date.now()): string {
  return `reportei-clients/${clientId}/logo-${now}.${ext}`;
}

/**
 * The storage path behind a public URL of ours, only when it is a logo of this
 * client — so a tampered value can never make us delete someone else's file. Pure.
 */
export function logoPathFromUrl(url: string | null | undefined, clientId: string): string | null {
  if (!url) return null;
  const marker = `/${LOGO_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  return path.startsWith(`reportei-clients/${clientId}/`) && !path.includes("..") ? path : null;
}

/** One or two capital letters for the round placeholder when a client has no logo. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[1].slice(0, 1);
  return letters.toLocaleUpperCase("pt-BR");
}

/** A stable hue (0–359) from the name, so each placeholder keeps its own colour. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/**
 * A stable pseudo-random subset (2 to 5) of `all` for a client, from its name. Only for
 * the local demo of the cards (NEXT_PUBLIC_REPORTEI_DEMO_ICONS=1), so the grid can be
 * seen with several networks before more connectors exist. Pure.
 */
// The model client (Amexlog) has the same networks as in Reportei, so its dashboard and
// reports can be compared one to one. Only in the local preview, like the rest of the demo.
const MODEL_CLIENT_NETWORKS = ["google_ads", "meta_ads", "instagram_business", "facebook"];

export function demoNetworks(seed: string, all: readonly string[]): string[] {
  if (all.length === 0) return [];
  if (seed.trim().toLowerCase() === "amexlog") return MODEL_CLIENT_NETWORKS.filter((n) => all.includes(n));
  let h = hueOf(seed) * 7919 + seed.length * 104729;
  const next = () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h;
  };
  const count = Math.min(all.length, 2 + (next() % 4));
  const pool = [...all];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(next() % pool.length, 1)[0]);
  return out;
}
