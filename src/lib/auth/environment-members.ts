// "Who can be picked in a filter of this environment": the people who actually
// have access to Comercial / Operacional. Same rule the app uses for the menu
// and route guards (use-auth.tsx): the account owner has both environments,
// everyone else gets the environments of their cargo (roles.environments).

import type { SupabaseClient } from "@supabase/supabase-js";

export type EnvironmentKey = "comercial" | "operational";

export interface EnvironmentMember {
  /** profiles.id — what `assigned_to` / `assignee_id` store. */
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
  account_role: string | null;
  role_id: string | null;
}

interface RoleRow {
  id: string;
  environments: string[] | null;
}

/** Pure rule, kept apart so it can be tested without a database. */
export function hasEnvironmentAccess(
  profile: Pick<ProfileRow, "account_role" | "role_id">,
  environmentsByRole: Map<string, string[]>,
  environment: EnvironmentKey,
): boolean {
  if (profile.account_role === "owner") return true;
  if (!profile.role_id) return false;
  return (environmentsByRole.get(profile.role_id) ?? []).includes(environment);
}

export function pickEnvironmentMembers(
  profiles: ProfileRow[],
  roles: RoleRow[],
  environment: EnvironmentKey,
): EnvironmentMember[] {
  const byRole = new Map(roles.map((r) => [r.id, r.environments ?? []]));
  return profiles
    .filter((p) => hasEnvironmentAccess(p, byRole, environment))
    .map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "—", avatarUrl: p.avatar_url ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** People of the account that can use `environment`, sorted by name. */
export async function loadEnvironmentMembers(
  db: SupabaseClient,
  environment: EnvironmentKey,
): Promise<EnvironmentMember[]> {
  const [profiles, roles] = await Promise.all([
    db.from("profiles").select("id, full_name, email, avatar_url, account_role, role_id").order("full_name"),
    db.from("roles").select("id, environments"),
  ]);
  if (profiles.error || roles.error) {
    console.error("Failed to load environment members:", (profiles.error ?? roles.error)?.message);
    return [];
  }
  return pickEnvironmentMembers((profiles.data ?? []) as ProfileRow[], (roles.data ?? []) as RoleRow[], environment);
}
