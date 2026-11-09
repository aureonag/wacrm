// Daily health check of the Meta connections: asks Meta whether each stored login
// still works. A login Meta rejects (token expired, revoked, password changed) is
// marked as failed — the ad accounts linked through it show it on the client page —
// and the person who made it gets a bell notice, once, when it goes down.

import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { META_API_BASE } from "./meta-ads";
import { markConnectionFailed } from "./meta-connection";
import { accountDownNotice, checkLinksOfConnection } from "./meta-link";

export interface HealthSummary {
  checked: number;
  down: number;
}

/** The notice for a connection that stopped working. Pure. */
export function connectionDownNotice(fbUserName: string | null) {
  return {
    type: "integration_down" as const,
    title: `A conexão com a Meta caiu${fbUserName ? ` (${fbUserName})` : ""}`,
    body: "Os relatórios das contas ligadas por ela não conseguem ler a Meta. Reconecte em Reportei → Clientes → Integrações.",
  };
}

/** Meta says the token itself is no good (code 190), as opposed to a permission or network problem. Pure. */
export function isTokenRejected(body: { error?: { code?: number } } | undefined): boolean {
  return body?.error?.code === 190;
}

/** Never throws: a health check must not break the automations that run in the same ping. */
export async function checkConnectionsHealth(): Promise<HealthSummary> {
  const summary: HealthSummary = { checked: 0, down: 0 };
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("meta_connections").select("id, account_id, user_id, fb_user_name, token_encrypted").eq("status", "connected").limit(200);
    if (error) {
      console.error("[reportei connection health] list", error.message);
      return summary;
    }
    for (const row of data ?? []) {
      summary.checked++;
      let token: string;
      try {
        token = decrypt(row.token_encrypted as string);
      } catch {
        console.error("[reportei connection health] could not decrypt a connection", row.id);
        continue;
      }
      try {
        const url = new URL(`${META_API_BASE}/me`);
        url.searchParams.set("fields", "id");
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const body = (await res.json().catch(() => undefined)) as { error?: { code?: number } } | undefined;
        if (!isTokenRejected(body)) {
          // The login works; each linked account is checked on its own (a login can keep working while one account is gone).
          const result = await checkLinksOfConnection(db, row.id as string, token);
          summary.down += result.broken.length;
          for (const b of result.broken) {
            const notice = accountDownNotice(b.name, b.state);
            const { data: enabled } = await db.rpc("notification_enabled", { p_user_id: row.user_id, p_type: notice.type });
            if (enabled === false) continue;
            const sent = await db.from("notifications").insert({ account_id: row.account_id, user_id: row.user_id, type: notice.type, title: notice.title, body: notice.body });
            if (sent.error) console.error("[reportei connection health] notify account", sent.error.message);
          }
          continue;
        }

        // Going from connected to failed happens once, so the notice cannot repeat.
        await markConnectionFailed(row.id as string, "error", "token_invalid");
        summary.down++;
        const notice = connectionDownNotice((row.fb_user_name as string | null) ?? null);
        const { data: enabled } = await db.rpc("notification_enabled", { p_user_id: row.user_id, p_type: notice.type });
        if (enabled === false) continue;
        const sent = await db.from("notifications").insert({ account_id: row.account_id, user_id: row.user_id, type: notice.type, title: notice.title, body: notice.body });
        if (sent.error) console.error("[reportei connection health] notify", sent.error.message);
      } catch (err) {
        // A network failure says nothing about the token: leave the connection as it is.
        console.error("[reportei connection health] check", row.id, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[reportei connection health]", err instanceof Error ? err.message : err);
  }
  return summary;
}
