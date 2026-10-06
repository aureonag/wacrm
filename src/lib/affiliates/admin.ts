// Server helpers for the Afiliados admin (Operacional → Afiliados).
//
// Access is gated by `requireRole("admin")` (owner/admin of the CRM account) —
// the same provisional rule as the SQL helper `aff_is_staff()` (migration 100).
// This deliberately does NOT use the Cargos/Permissões system, which is being
// reorganized separately; when it is ready, swap the check in `requireStaff`
// (and `aff_is_staff()` in SQL) — nothing else needs to change.
//
// Data access uses the service-role client, so every route MUST call
// `requireStaff()` first.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, UnauthorizedError, type AccountContext } from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { BadInput } from "./campaigns";
import {
  effectivePermissions,
  FULL_ACCESS,
  isStoreRole,
  satisfies,
  type Need,
  type StorePermissions,
} from "./store-access";

export interface StaffContext {
  ctx: AccountContext;
  admin: SupabaseClient;
}

export async function requireStaff(): Promise<StaffContext> {
  const ctx = await requireRole("admin");
  return { ctx, admin: supabaseAdmin() };
}

/** Who is acting — written to the audit trail. */
export interface AuditActor {
  userId: string;
  name: string | null;
  kind: "staff" | "client";
}

export interface ClientAccess {
  /** Same shape the routes always used: `ctx.userId` is the acting person. */
  ctx: AuditActor;
  admin: SupabaseClient;
  kind: "staff" | "client";
  permissions: StorePermissions;
}

/**
 * Guard for the routes of ONE client (loja): the Aureon team (owner/admin of
 * the CRM) can do everything; a person of that store can do what their role
 * and overrides allow (store-access.ts). Anyone else gets 401/403. A portal
 * user can only ever reach the client they belong to — the id in the URL is
 * always checked against aff_client_users, never trusted.
 */
export async function requireClientAccess(clientId: string, need: Need): Promise<ClientAccess> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  const admin = supabaseAdmin();

  if (user.app_metadata?.aff_portal !== true) {
    // A CRM user: only owner/admin (the Aureon team) get in.
    const ctx = await requireRole("admin");
    return {
      ctx: { userId: ctx.userId, name: ctx.account?.name ?? null, kind: "staff" },
      admin,
      kind: "staff",
      permissions: FULL_ACCESS,
    };
  }

  const { data, error: lookupErr } = await admin
    .from("aff_client_users")
    .select("name, role, permissions, status, aff_clients(status)")
    .eq("client_id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[affiliates] store user lookup failed:", lookupErr.message);
    throw new ForbiddenError("Could not load access");
  }
  const clientStatus = (data?.aff_clients as unknown as { status: string } | null)?.status;
  if (!data || data.status !== "active" || clientStatus !== "active") throw new ForbiddenError("No access to this account");

  const permissions = effectivePermissions(isStoreRole(data.role) ? data.role : "viewer", data.permissions);
  if (!satisfies(permissions, need)) throw new ForbiddenError("Your access does not allow this");
  return { ctx: { userId: user.id, name: data.name, kind: "client" }, admin, kind: "client", permissions };
}

/** Postgres "undefined_table": the aff_* migrations are not applied yet. */
export function isModuleNotReady(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export function moduleNotReadyResponse(): NextResponse {
  return NextResponse.json({ error: "module_not_ready" }, { status: 503 });
}

export async function writeAudit(
  admin: SupabaseClient,
  ctx: AccountContext | AuditActor,
  entry: { clientId: string | null; action: string; objectType: string; objectId: string },
): Promise<void> {
  const actor: AuditActor =
    "kind" in ctx ? ctx : { userId: ctx.userId, name: ctx.account?.name ?? null, kind: "staff" };
  const { error } = await admin.from("aff_audit").insert({
    client_id: entry.clientId,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    actor_kind: actor.kind,
    action: entry.action,
    object_type: entry.objectType,
    object_id: entry.objectId,
  });
  if (error) console.error("[affiliates] audit insert failed:", error.message);
}

const PLATFORMS = ["nuvemshop", "tray", "outra"] as const;
export type AffPlatform = (typeof PLATFORMS)[number];

function optText(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new BadInput("Campo inválido.");
  const s = v.trim();
  if (s.length > max) throw new BadInput("Texto longo demais.");
  return s === "" ? null : s;
}

export { BadInput };

export interface ClientInput {
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  platform: AffPlatform | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

/** Validates the create/edit body for a client (loja). Throws BadInput. */
export function parseClientInput(body: unknown): ClientInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = optText(b.name, 200);
  if (!name) throw new BadInput("Informe o nome do cliente.");
  const platform = optText(b.platform, 20);
  if (platform && !(PLATFORMS as readonly string[]).includes(platform)) {
    throw new BadInput("Plataforma inválida.");
  }
  const email = optText(b.contact_email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadInput("E-mail inválido.");
  const cnpjRaw = optText(b.cnpj, 30);
  const cnpj = cnpjRaw ? cnpjRaw.replace(/\D/g, "") : null;
  if (cnpj && cnpj.length !== 14) throw new BadInput("CNPJ deve ter 14 dígitos.");
  return {
    name,
    legal_name: optText(b.legal_name, 200),
    cnpj,
    platform: platform as AffPlatform | null,
    contact_name: optText(b.contact_name, 200),
    contact_email: email,
    contact_phone: optText(b.contact_phone, 40),
    notes: optText(b.notes, 5000),
  };
}
