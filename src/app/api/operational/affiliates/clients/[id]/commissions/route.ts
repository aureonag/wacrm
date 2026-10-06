// GET  /api/operational/affiliates/clients/:id/commissions — commissions of one client.
// POST /api/operational/affiliates/clients/:id/commissions — close a commission
//      (affiliate × competência × valor bruto). Manual closing for now: orders
//      are not synced from the store yet, so nothing is computed automatically.
//
// Aureon staff, or a store user with the right permission — see requireClientAccess in src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import {
  BadInput,
  isModuleNotReady,
  moduleNotReadyResponse,
  requireClientAccess,
  writeAudit,
} from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { parseCommissionInput } from "@/lib/affiliates/commissions";
import { COMMISSION_COLUMNS, toCommission, type CommissionRow } from "@/lib/affiliates/commissions-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin } = await requireClientAccess(id, [["commissions", "view"], ["invoices", "view"], ["payments", "view"]]);

    const { data, error } = await admin
      .from("aff_commissions")
      .select(`${COMMISSION_COLUMNS}, aff_affiliates(name, email)`)
      .eq("client_id", id)
      .order("period", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/commissions]", error.message);
      return NextResponse.json({ error: "Failed to load commissions" }, { status: 500 });
    }
    return NextResponse.json({ commissions: ((data ?? []) as unknown as CommissionRow[]).map(toCommission) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["commissions", "edit"]]);
    const input = parseCommissionInput(await req.json().catch(() => null));

    // The affiliate must be an approved participant of THIS client.
    const member = await admin
      .from("aff_memberships")
      .select("id")
      .eq("client_id", id)
      .eq("affiliate_id", input.affiliate_id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (member.error) {
      if (isModuleNotReady(member.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to close commission" }, { status: 500 });
    }
    if (!member.data) {
      return NextResponse.json({ error: "Este afiliado não participa desta loja." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("aff_commissions")
      .insert({ client_id: id, affiliate_id: input.affiliate_id, period: input.period, gross_cents: input.gross_cents })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Já existe uma comissão deste afiliado nesta competência." },
          { status: 409 },
        );
      }
      console.error("[POST affiliates/commissions]", error.message);
      return NextResponse.json({ error: "Failed to close commission" }, { status: 500 });
    }

    await writeAudit(admin, ctx, { clientId: id, action: "Fechou comissão", objectType: "commission", objectId: data.id });
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
