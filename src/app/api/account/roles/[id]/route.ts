// PATCH  /api/account/roles/[id] — rename / change environments / change
//        permission grants. Admin+.
// DELETE /api/account/roles/[id] — admin+; RLS blocks deleting a
//        system-default cargo (Administrador/Comercial/Visualizador),
//        surfaced here as a 403 rather than a silent no-op.

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { PlatformEnvironment } from "@/types";

const VALID_ENVIRONMENTS: PlatformEnvironment[] = ["comercial", "operational"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:roleUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; environments?: unknown; permission_ids?: unknown }
      | null;

    const patch: Record<string, unknown> = {};
    if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (Array.isArray(body?.environments)) {
      patch.environments = body.environments.filter((e): e is PlatformEnvironment =>
        VALID_ENVIRONMENTS.includes(e),
      );
    }

    if (Object.keys(patch).length > 0) {
      const { data, error } = await ctx.supabase.from("roles").update(patch).eq("id", id).select("id").maybeSingle();
      if (error) {
        if (error.code === "23505") {
          return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
        }
        console.error("[PATCH /api/account/roles/[id]] update error:", error);
        return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
      }
      if (!data) return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (Array.isArray(body?.permission_ids)) {
      const permissionIds = body.permission_ids.filter((p): p is string => typeof p === "string");
      const { error: delError } = await ctx.supabase.from("role_permissions").delete().eq("role_id", id);
      if (delError) {
        console.error("[PATCH /api/account/roles/[id]] clear permissions error:", delError);
        return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
      }
      if (permissionIds.length > 0) {
        const { error: insError } = await ctx.supabase
          .from("role_permissions")
          .insert(permissionIds.map((permission_id) => ({ role_id: id, permission_id })));
        if (insError) {
          console.error("[PATCH /api/account/roles/[id]] insert permissions error:", insError);
          return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:roleDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const { data, error } = await ctx.supabase.from("roles").delete().eq("id", id).select("id").maybeSingle();

    if (error) {
      console.error("[DELETE /api/account/roles/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete role" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Role not found, or it's a default role and can't be deleted" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
