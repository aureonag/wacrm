// Shared by the store-users API routes (Next.js route files can only export
// HTTP handlers, so the helpers live here).

import { BadInput } from "./campaigns";
import {
  effectivePermissions,
  isStoreRole,
  parseOverrides,
  STORE_ROLES,
  type StoreRole,
} from "./store-access";

export const STORE_USER_COLUMNS = "id, user_id, name, email, role, permissions, status, created_at";

export interface StoreUserRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  permissions: unknown;
  status: string;
  created_at: string;
}

/** What the browser gets (never the Auth user id). */
export function toStoreUser(r: StoreUserRow) {
  const role = isStoreRole(r.role) ? r.role : "viewer";
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role,
    overrides: parseOverrides(r.permissions),
    permissions: effectivePermissions(role, r.permissions),
    status: r.status,
    created_at: r.created_at,
  };
}

export type StoreUser = ReturnType<typeof toStoreUser>;

export function parseRole(v: unknown): StoreRole {
  if (!isStoreRole(v)) throw new BadInput(`Perfil inválido. Use: ${STORE_ROLES.join(", ")}.`);
  return v;
}
