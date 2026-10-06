// Server helpers for the STORE side of the Afiliados portal: who the logged-in
// person is (a person of one or more stores, an affiliate, or Aureon staff
// looking at a store) and creating the login of a new store user.
//
// Store users are Supabase Auth users WITHOUT a CRM profile, flagged
// app_metadata.aff_portal = true (migrations 101/104) — exactly like affiliates.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { effectivePermissions, FULL_ACCESS, isStoreRole, type StorePermissions, type StoreRole } from "./store-access";

export interface StoreMembership {
  client_id: string;
  client_name: string;
  role: StoreRole;
  permissions: StorePermissions;
}

export interface PortalSession {
  /** "staff" = Aureon team looking at a store ("Ver como cliente"). */
  kind: "portal" | "staff";
  userId: string;
  name: string | null;
  isAffiliate: boolean;
  stores: StoreMembership[];
}

/**
 * Resolves what the logged-in person can open in the portal.
 * - portal user: every active store they belong to (+ whether they are an affiliate);
 * - Aureon staff: only the store passed in `staffClientId`, with full access.
 */
export async function loadPortalSession(staffClientId?: string | null): Promise<PortalSession> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  const admin = supabaseAdmin();

  if (user.app_metadata?.aff_portal !== true) {
    const ctx = await requireRole("admin");
    const stores: StoreMembership[] = [];
    if (staffClientId) {
      const { data } = await admin.from("aff_clients").select("id, name").eq("id", staffClientId).eq("status", "active").maybeSingle();
      if (data) stores.push({ client_id: data.id, client_name: data.name, role: "owner", permissions: FULL_ACCESS });
    }
    return { kind: "staff", userId: ctx.userId, name: ctx.account?.name ?? null, isAffiliate: false, stores };
  }

  const [rows, affiliate] = await Promise.all([
    admin
      .from("aff_client_users")
      .select("client_id, name, role, permissions, status, aff_clients(name, status)")
      .eq("user_id", user.id)
      .eq("status", "active"),
    admin.from("aff_affiliates").select("id").eq("user_id", user.id).eq("status", "active").maybeSingle(),
  ]);
  if (rows.error) {
    console.error("[affiliates/store-portal] memberships lookup failed:", rows.error.message);
    throw new ForbiddenError("Could not load access");
  }

  const stores: StoreMembership[] = [];
  let name: string | null = null;
  for (const r of (rows.data ?? []) as unknown as {
    client_id: string;
    name: string;
    role: string;
    permissions: unknown;
    aff_clients: { name: string; status: string } | null;
  }[]) {
    if (r.aff_clients?.status !== "active") continue;
    name = name ?? r.name;
    const role = isStoreRole(r.role) ? r.role : "viewer";
    stores.push({ client_id: r.client_id, client_name: r.aff_clients.name, role, permissions: effectivePermissions(role, r.permissions) });
  }
  stores.sort((a, b) => a.client_name.localeCompare(b.client_name, "pt-BR"));
  return { kind: "portal", userId: user.id, name, isAffiliate: Boolean(affiliate.data), stores };
}

export type PortalUserFailure = "exists" | "weak_password" | "not_ready" | "failed";

export class PortalUserError extends Error {
  constructor(readonly code: PortalUserFailure) {
    super(code);
    this.name = "PortalUserError";
  }
}

/**
 * Creates the Auth login of a new portal user (store person). The marker goes
 * in user_metadata too because the auth service writes app_metadata only AFTER
 * inserting the row (migration 104). Defense in depth: a portal user must
 * never own a CRM profile — if one appears, undo and report "not_ready".
 */
export async function createPortalUser(
  admin: SupabaseClient,
  input: { email: string; password: string; name: string },
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: { aff_portal: true },
    user_metadata: { full_name: input.name, aff_portal: true },
  });
  if (created.error || !created.data.user) {
    const msg = created.error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) throw new PortalUserError("exists");
    if (/password/i.test(msg)) throw new PortalUserError("weak_password");
    console.error("[affiliates/store-portal] createUser failed:", msg);
    throw new PortalUserError("failed");
  }
  const userId = created.data.user.id;

  const profile = await admin.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
  if (profile.data) {
    console.error("[affiliates/store-portal] CRITICAL: portal user got a CRM profile — rolling back", userId);
    const del = await admin.auth.admin.deleteUser(userId);
    if (del.error) console.error("[affiliates/store-portal] CRITICAL: rollback could not delete user", userId, del.error.message);
    throw new PortalUserError("not_ready");
  }
  return userId;
}

/** Deletes a login created seconds ago when the rest of the operation failed. */
export async function dropNewPortalUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error("[affiliates/store-portal] CRITICAL: rollback could not delete user", userId, error.message);
}
