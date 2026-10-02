// PATCH /api/operational/affiliates/clients/:id
//   body { status: 'active' | 'suspended' | 'removed' }  → change access
//   body { name, ... }                                   → edit data
//
// "Remover" is a soft delete (status = 'removed'): the client loses access and
// disappears from the list, but campaigns/commissions/audit are preserved.
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireStaff();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await admin
      .from("aff_clients")
      .select("id, name, platform, status")
      .eq("id", id)
      .neq("status", "removed")
      .maybeSingle();
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/clients/:id]", error.message);
      return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ client: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const STATUS_ACTION: Record<string, string> = {
  active: "Reativou cliente",
  suspended: "Suspendeu cliente",
  removed: "Removeu cliente",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

    let patch: Record<string, unknown>;
    let action: string;
    if (typeof body.status === "string") {
      if (!(body.status in STATUS_ACTION)) return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      const now = new Date().toISOString();
      patch = {
        status: body.status,
        suspended_at: body.status === "suspended" ? now : null,
        removed_at: body.status === "removed" ? now : null,
      };
      action = STATUS_ACTION[body.status];
    } else {
      patch = { ...parseClientInput(body) };
      action = "Editou cliente";
    }

    const { data, error } = await admin
      .from("aff_clients")
      .update(patch)
      .eq("id", id)
      .neq("status", "removed")
      .select("id")
      .maybeSingle();
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      if (error.code === "23505") {
        return NextResponse.json({ error: "Já existe um cliente com este CNPJ." }, { status: 409 });
      }
      console.error("[PATCH affiliates/clients/:id]", error.message);
      return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await writeAudit(admin, ctx, { clientId: id, action, objectType: "client", objectId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
