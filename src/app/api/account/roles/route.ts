// ============================================================
// /api/account/roles — Cargos (migration 058)
//
//   GET  — list this account's cargos, with the permission ids each
//          grants. Any member (read-only for non-admins).
//   POST — create a cargo. Admin+.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { PlatformEnvironment, Role } from "@/types";

const VALID_ENVIRONMENTS: PlatformEnvironment[] = ["comercial", "operational"];

async function loadRoles(supabase: Awaited<ReturnType<typeof getCurrentAccount>>["supabase"], accountId: string) {
  const { data: roles, error } = await supabase
    .from("roles")
    .select("id, account_id, name, environments, is_system_default")
    .eq("account_id", accountId)
    .order("is_system_default", { ascending: false })
    .order("name");
  if (error) throw error;

  const roleIds = (roles ?? []).map((r) => r.id as string);
  const permsByRole = new Map<string, string[]>();
  if (roleIds.length > 0) {
    const { data: rolePerms, error: rpError } = await supabase
      .from("role_permissions")
      .select("role_id, permission_id")
      .in("role_id", roleIds);
    if (rpError) throw rpError;
    for (const row of (rolePerms ?? []) as { role_id: string; permission_id: string }[]) {
      const bucket = permsByRole.get(row.role_id) ?? [];
      bucket.push(row.permission_id);
      permsByRole.set(row.role_id, bucket);
    }
  }

  return (roles ?? []).map(
    (r): Role => ({
      id: r.id,
      account_id: r.account_id,
      name: r.name,
      environments: r.environments ?? [],
      is_system_default: r.is_system_default,
      permission_ids: permsByRole.get(r.id) ?? [],
    }),
  );
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const roles = await loadRoles(ctx.supabase, ctx.accountId);
    return NextResponse.json({ roles });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:roleCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; environments?: unknown; permission_ids?: unknown }
      | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const environments = Array.isArray(body?.environments)
      ? body.environments.filter((e): e is PlatformEnvironment => VALID_ENVIRONMENTS.includes(e))
      : [];
    const permissionIds = Array.isArray(body?.permission_ids)
      ? body.permission_ids.filter((p): p is string => typeof p === "string")
      : [];

    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }

    const { data: role, error } = await ctx.supabase
      .from("roles")
      .insert({ account_id: ctx.accountId, name, environments, is_system_default: false })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
      }
      console.error("[POST /api/account/roles] insert error:", error);
      return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
    }

    if (permissionIds.length > 0) {
      const { error: rpError } = await ctx.supabase
        .from("role_permissions")
        .insert(permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })));
      if (rpError) {
        console.error("[POST /api/account/roles] role_permissions insert error:", rpError);
        return NextResponse.json({ error: "Role created, but failed to save permissions" }, { status: 500 });
      }
    }

    return NextResponse.json({ id: role.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
