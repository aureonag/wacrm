// GET  /api/operational/affiliates/clients — every client (loja) of the
//                                           Afiliados SaaS, with counts.
// POST /api/operational/affiliates/clients — register a new client.
//
// Staff only (owner/admin) — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import {
  BadInput,
  isModuleNotReady,
  moduleNotReadyResponse,
  parseClientInput,
  requireStaff,
  writeAudit,
} from "@/lib/affiliates/admin";

function countBy(rows: { client_id: string }[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) m.set(r.client_id, (m.get(r.client_id) ?? 0) + 1);
  return m;
}

export async function GET() {
  try {
    const { admin } = await requireStaff();

    const { data: clients, error } = await admin
      .from("aff_clients")
      .select("id, name, legal_name, cnpj, platform, contact_name, contact_email, contact_phone, notes, status, created_at")
      .neq("status", "removed")
      .order("created_at", { ascending: false });
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/clients]", error.message);
      return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
    }

    const [users, campaigns, memberships] = await Promise.all([
      admin.from("aff_client_users").select("client_id").neq("status", "disabled"),
      admin.from("aff_campaigns").select("client_id").eq("status", "active"),
      admin.from("aff_memberships").select("client_id").eq("status", "approved"),
    ]);
    const usersBy = countBy(users.data);
    const campaignsBy = countBy(campaigns.data);
    const affiliatesBy = countBy(memberships.data);

    return NextResponse.json({
      clients: (clients ?? []).map((c) => ({
        ...c,
        users: usersBy.get(c.id) ?? 0,
        campaigns: campaignsBy.get(c.id) ?? 0,
        affiliates: affiliatesBy.get(c.id) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, admin } = await requireStaff();
    const input = parseClientInput(await req.json().catch(() => null));

    const { data, error } = await admin
      .from("aff_clients")
      .insert({ ...input, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      if (error.code === "23505") {
        return NextResponse.json({ error: "Já existe um cliente com este CNPJ." }, { status: 409 });
      }
      console.error("[POST affiliates/clients]", error.message);
      return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
    }

    await writeAudit(admin, ctx, { clientId: data.id, action: "Cadastrou cliente", objectType: "client", objectId: data.id });
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
