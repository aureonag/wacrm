"use client";

import { useAuth } from "@/hooks/use-auth";

export type Environment = "comercial" | "operational";

/**
 * Whether the current user's cargo grants entry to an environment
 * (Comercial/Operacional — migration 058). Owner always has both.
 */
export function useHasEnvironmentAccess(environment: Environment): boolean {
  const { environments } = useAuth();
  return environments.has(environment);
}

/**
 * Whether the current user's cargo (or an individual override) grants one
 * specific permission. Synchronous — reads the set `use-auth.tsx` already
 * resolved at login via `get_my_permissions()`, no extra round trip per
 * check. Owner always passes.
 */
export function useHasPermission(environment: Environment, module: string, action: string): boolean {
  const { isOwner, permissions } = useAuth();
  return isOwner || permissions.has(`${environment}:${module}:${action}`);
}
