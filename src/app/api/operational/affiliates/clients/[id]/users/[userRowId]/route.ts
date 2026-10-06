// PATCH /api/operational/affiliates/clients/:id/users/:userRowId — change a
// person of the store: name, role, per-person permissions, active/disabled.
//
// Aureon staff, or a store user with team permission. Guard rails: nobody
// edits their own role/permissions/status (no accidental lock-out) and a store
// always keeps at least one active owner. Disabling keeps the history.

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
import { parseOverrides } from "@/lib/affiliates/store-access";
import { parseRole, STORE_USER_COLUMNS, toStoreUser, type StoreUserRow } from "@/lib/affiliates/store-users";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; userRowId: string }> }) {
  try {
    const { id, userRowId } = await params;
    if (!isUuid(id) || !isUuid(userRowId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["team", "edit"]]);

    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if ("name" in b) {
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name || name.length > 200) throw new BadInput("Informe o nome da pessoa.");
      update.name = name;
    }
    if ("role" in b) update.role = parseRole(b.role);
    if ("permissions" in b) update.permissions = parseOverrides(b.permissions);
    if ("status" in b) {
      if (b.status !== "active" && b.status !== "disabled") throw new BadInput("Situação inválida.");
      update.status = b.status;
    }
    if (Object.keys(update).length === 0) throw new BadInput("Nada para alterar.");

    const current = await admin
      .from("aff_client_users")
      .select(STORE_USER_COLUMNS)
      .eq("id", userRowId)
      .eq("client_id", id)
      .maybeSingle();
    if (current.error) {
      if (isModuleNotReady(current.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
    if (!current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const row = current.data as StoreUserRow;

    const touchesAccess = "role" in update || "permissions" in update || "status" in update;
    if (ctx.kind === "client" && row.user_id === ctx.userId && touchesAccess) {
      return NextResponse.json({ error: "Você não pode alterar o seu próprio acesso." }, { status: 409 });
    }

    // The store must keep an active owner.
    const wasActiveOwner = row.role === "owner" && row.status === "active";
    const staysActiveOwner = (update.role ?? row.role) === "owner" && (update.status ?? row.status) === "active";
    if (wasActiveOwner && !staysActiveOwner) {
      const owners = await admin
        .from("aff_client_users")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .eq("role", "owner")
        .eq("status", "active");
      if ((owners.count ?? 0) <= 1) {
        return NextResponse.json({ error: "A loja precisa de pelo menos um proprietário ativo." }, { status: 409 });
      }
    }

    const { data, error } = await admin
      .from("aff_client_users")
      .update(update)
      .eq("id", userRowId)
      .eq("client_id", id)
      .select(STORE_USER_COLUMNS)
      .single();
    if (error) {
      console.error("[PATCH affiliates/users]", error.message);
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }

    const action =
      update.status === "disabled"
        ? "Desativou pessoa da equipe"
        : update.status === "active" && row.status !== "active"
          ? "Reativou pessoa da equipe"
          : "Alterou acesso da equipe";
    await writeAudit(admin, ctx, { clientId: id, action, objectType: "client_user", objectId: userRowId });
    return NextResponse.json({ user: toStoreUser(data as StoreUserRow) });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
