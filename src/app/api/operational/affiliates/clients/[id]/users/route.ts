// GET  /api/operational/affiliates/clients/:id/users — the people of a store.
// POST /api/operational/affiliates/clients/:id/users — add a person to the store.
//
// Aureon staff, or a store user with team permission (the owner by default).
// The login is created without a CRM account (portal user). A person who
// already has a portal login (another store, or an affiliate) is linked
// without touching their password.

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
import { parseOverrides, type StoreOverrides } from "@/lib/affiliates/store-access";
import { parseRole, STORE_USER_COLUMNS, toStoreUser, type StoreUserRow } from "@/lib/affiliates/store-users";
import { createPortalUser, dropNewPortalUser, PortalUserError } from "@/lib/affiliates/store-portal";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin } = await requireClientAccess(id, [["team", "view"]]);

    const { data, error } = await admin
      .from("aff_client_users")
      .select(STORE_USER_COLUMNS)
      .eq("client_id", id)
      .order("created_at", { ascending: true });
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/users]", error.message);
      return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
    }
    return NextResponse.json({ users: ((data ?? []) as StoreUserRow[]).map(toStoreUser) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["team", "edit"]]);

    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!name || name.length > 200) throw new BadInput("Informe o nome da pessoa.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new BadInput("Informe um e-mail válido.");
    const role = parseRole(b.role);
    const overrides: StoreOverrides = parseOverrides(b.permissions);
    const password = typeof b.password === "string" ? b.password : "";

    const client = await admin.from("aff_clients").select("id").eq("id", id).eq("status", "active").maybeSingle();
    if (client.error) {
      if (isModuleNotReady(client.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to add user" }, { status: 500 });
    }
    if (!client.data) return NextResponse.json({ error: "Cliente indisponível." }, { status: 409 });

    const already = await admin.from("aff_client_users").select("id, user_id").eq("client_id", id).ilike("email", email).maybeSingle();
    if (already.data) return NextResponse.json({ error: "Esta pessoa já faz parte da equipe desta loja." }, { status: 409 });

    // A person who already has a portal login (another store / an affiliate).
    const [otherStore, asAffiliate] = await Promise.all([
      admin.from("aff_client_users").select("user_id").ilike("email", email).limit(1).maybeSingle(),
      admin.from("aff_affiliates").select("user_id").ilike("email", email).not("user_id", "is", null).limit(1).maybeSingle(),
    ]);
    let userId: string | null = otherStore.data?.user_id ?? asAffiliate.data?.user_id ?? null;
    let created = false;

    if (!userId) {
      if (password.length < 10 || password.length > 200) {
        throw new BadInput("Defina uma senha inicial de pelo menos 10 caracteres.");
      }
      try {
        userId = await createPortalUser(admin, { email, password, name });
        created = true;
      } catch (err) {
        if (err instanceof PortalUserError) {
          if (err.code === "exists") {
            return NextResponse.json({ error: "Este e-mail já tem outro tipo de conta. Use outro e-mail." }, { status: 409 });
          }
          if (err.code === "weak_password") return NextResponse.json({ error: "Escolha uma senha mais forte." }, { status: 400 });
          if (err.code === "not_ready") return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
        }
        return NextResponse.json({ error: "Failed to add user" }, { status: 500 });
      }
    }

    const { data, error } = await admin
      .from("aff_client_users")
      .insert({ client_id: id, user_id: userId, name, email, role, permissions: overrides, status: "active" })
      .select(STORE_USER_COLUMNS)
      .single();
    if (error) {
      if (created) await dropNewPortalUser(admin, userId);
      if (error.code === "23505") return NextResponse.json({ error: "Esta pessoa já faz parte da equipe desta loja." }, { status: 409 });
      console.error("[POST affiliates/users]", error.message);
      return NextResponse.json({ error: "Failed to add user" }, { status: 500 });
    }

    await writeAudit(admin, ctx, { clientId: id, action: "Adicionou pessoa à equipe", objectType: "client_user", objectId: data.id });
    return NextResponse.json({ user: toStoreUser(data as StoreUserRow), login_created: created }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
