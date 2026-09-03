// ============================================================
// Server-side permission check — the Cargos+Permissões layer
// (migration 058) on top of `requireRole`. Additive: this never
// replaces `requireRole`, which still gates every existing
// Comercial route exactly as before.
//
// Use this for routes scoped to a specific (environment, module,
// action) — today, none yet (the Operacional environment ships
// its first real routes in Etapa 2). `requireRole("admin")`
// remains the right check for account-management-class routes
// (members, cargos, setores) — see `src/lib/auth/account.ts`.
// ============================================================

import { ForbiddenError, getCurrentAccount, type AccountContext } from "./account";
import type { Environment } from "@/hooks/use-permissions";

/**
 * Resolve the caller's account context and enforce one granular
 * permission via the `has_permission` SQL function (same source of
 * truth the client reads through `get_my_permissions()`). Owner always
 * passes — `has_permission` bypasses for them itself.
 */
export async function requirePermission(
  environment: Environment,
  module: string,
  action: string,
): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  const { data, error } = await ctx.supabase.rpc("has_permission", {
    p_environment: environment,
    p_module: module,
    p_action: action,
  });
  if (error) {
    console.error("[requirePermission] has_permission RPC error:", error.message);
    throw new ForbiddenError("Could not verify permission");
  }
  if (!data) {
    throw new ForbiddenError(`Missing permission: ${environment}:${module}:${action}`);
  }
  return ctx;
}
