// POST /api/operational/reportei/clients/:id/integrations — links ad accounts
// to the client ("Integrar contas selecionadas"). Body:
//   { provider: "meta_ads", accounts: [{ id, name, currency?, timezone? }] }
// Accounts already linked to this client are left as they are. Needs
// edit_boards; uses the caller's own session (RLS).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { ValidationError } from "@/lib/operational/clients-projects";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_PER_REQUEST = 100;

interface AccountInput {
  id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function parseBody(body: unknown): AccountInput[] {
  if (!body || typeof body !== "object") throw new ValidationError("Dados inválidos.");
  const b = body as Record<string, unknown>;
  if (b.provider !== "meta_ads") throw new ValidationError("Rede inválida.");
  if (!Array.isArray(b.accounts) || b.accounts.length === 0) throw new ValidationError("Escolha ao menos uma conta.");
  if (b.accounts.length > MAX_PER_REQUEST) throw new ValidationError("Contas demais de uma vez.");
  return b.accounts.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const id = str(o.id, 100);
    if (!id || !/^act_\d+$/.test(id)) throw new ValidationError("Conta inválida.");
    return { id, name: str(o.name, 200), currency: str(o.currency, 10), timezone: str(o.timezone, 60) };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const accounts = parseBody(await req.json().catch(() => null));

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error } = await ctx.supabase.from("ad_integrations").upsert(
      accounts.map((a) => ({
        account_id: ctx.accountId,
        client_id: id,
        provider: "meta_ads",
        external_account_id: a.id,
        external_account_name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        created_by: ctx.userId,
      })),
      { onConflict: "client_id,provider,external_account_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("[POST reportei/clients/:id/integrations]", error.message);
      return NextResponse.json({ error: "Failed to link accounts" }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
