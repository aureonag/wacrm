// POST /api/operational/reportei/clients/:id/integrations — links ad accounts
// to the client ("Integrar contas selecionadas"). Body:
//   { provider: "meta_ads", accounts: [{ id, connectionId }] }
//
// Nothing the browser sends about an account is trusted beyond its id and the
// connection it was listed under. For each account the server
//   1. needs a connection of this company that is working (no silent fallback),
//   2. asks Meta to describe the account with that login (name, currency, time zone
//      come from Meta) and reads its last 7 days once,
//   3. only then links it.
// Already linked and working: left as it is. Linked but in error: recovered, with the
// connection that just proved access, keeping its campaign filter and history.
// Answer: { results: [{ id, result: "linked" | "recovered" | "already_linked" | "failed", state?, reason? }] }
// 201 when something was linked or recovered, 200 when everything was already linked,
// 422 when nothing could be linked. Needs edit_boards; writes with the caller's session (RLS).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { ValidationError } from "@/lib/operational/clients-projects";
import { mapLimit } from "@/lib/reportei/dashboard";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { checkLink, healthPatch, type LinkState } from "@/lib/reportei/meta-link";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_PER_REQUEST = 50;

interface AccountInput {
  id: string;
  connectionId: string;
}

function parseBody(body: unknown): AccountInput[] {
  if (!body || typeof body !== "object") throw new ValidationError("Dados inválidos.");
  const b = body as Record<string, unknown>;
  if (b.provider !== "meta_ads") throw new ValidationError("Rede inválida.");
  if (!Array.isArray(b.accounts) || b.accounts.length === 0) throw new ValidationError("Escolha ao menos uma conta.");
  if (b.accounts.length > MAX_PER_REQUEST) throw new ValidationError("Contas demais de uma vez.");
  const seen = new Set<string>();
  return b.accounts.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!/^act_\d+$/.test(id) || id.length > 100) throw new ValidationError("Conta inválida.");
    if (seen.has(id)) throw new ValidationError("Conta repetida.");
    seen.add(id);
    const cid = typeof o.connectionId === "string" ? o.connectionId.trim() : "";
    if (!UUID.test(cid)) throw new ValidationError("Conexão obrigatória.");
    return { id, connectionId: cid };
  });
}

type Result = { id: string; result: "linked" | "recovered" | "already_linked" | "failed"; state?: LinkState; reason?: string };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const accounts = parseBody(await req.json().catch(() => null));

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const existing = await ctx.supabase
      .from("ad_integrations")
      .select("id, external_account_id, status")
      .eq("client_id", id)
      .eq("account_id", ctx.accountId)
      .eq("provider", "meta_ads")
      .limit(1000);
    if (existing.error) return NextResponse.json({ error: "Failed to load links" }, { status: 500 });
    const linked = new Map((existing.data ?? []).map((r) => [r.external_account_id as string, { id: r.id as string, status: r.status as string }]));

    const results: Result[] = await mapLimit(accounts, 3, async (a): Promise<Result> => {
      const current = linked.get(a.id);
      if (current?.status === "connected") return { id: a.id, result: "already_linked" };

      // No fallback to another login: an unknown or dead connection is a failure of this account.
      const connection = await getCompanyConnection(ctx.accountId, a.connectionId);
      if (!connection) return { id: a.id, result: "failed", state: "failed", reason: "connection_unavailable" };

      const check = await checkLink(connection.token, a.id);
      if (check.state !== "operational" && check.state !== "no_delivery") return { id: a.id, result: "failed", state: check.state, reason: check.state };
      const account = check.account!;

      if (current) {
        // Explicit recovery of a link in error: new connection and status, same row (filters and history stay).
        const upd = await ctx.supabase
          .from("ad_integrations")
          .update({ connection_id: a.connectionId, ...healthPatch(check, new Date()), last_synced_at: new Date().toISOString(), currency: account.currency, timezone: account.timezone, external_account_name: account.name })
          .eq("id", current.id)
          .eq("account_id", ctx.accountId);
        if (upd.error) {
          console.error("[POST reportei/clients/:id/integrations] recover", upd.error.message);
          return { id: a.id, result: "failed", state: "failed", reason: "save_failed" };
        }
        return { id: a.id, result: "recovered", state: check.state };
      }

      const ins = await ctx.supabase.from("ad_integrations").insert({
        account_id: ctx.accountId,
        client_id: id,
        connection_id: a.connectionId,
        provider: "meta_ads",
        external_account_id: a.id,
        external_account_name: account.name,
        currency: account.currency,
        timezone: account.timezone,
        ...healthPatch(check, new Date()),
        last_synced_at: new Date().toISOString(),
        created_by: ctx.userId,
      });
      if (ins.error) {
        // Two requests at once: the other one linked it first.
        if (ins.error.code === "23505") return { id: a.id, result: "already_linked" };
        console.error("[POST reportei/clients/:id/integrations]", ins.error.message);
        return { id: a.id, result: "failed", state: "failed", reason: "save_failed" };
      }
      return { id: a.id, result: "linked", state: check.state };
    });

    const changed = results.some((r) => r.result === "linked" || r.result === "recovered");
    const allFailed = results.every((r) => r.result === "failed");
    return NextResponse.json({ results }, { status: changed ? 201 : allFailed ? 422 : 200 });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
