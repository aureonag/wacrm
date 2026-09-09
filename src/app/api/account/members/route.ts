// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  role_id: string | null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("id, user_id, full_name, email, avatar_url, account_role, created_at, role_id")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);
    const rows = data as ProfileRow[];

    // Setores (migration 058) — batch-fetched by profile id, same
    // "second query + map" shape used throughout the app for one-to-many
    // child data (e.g. hydrateLineItemsAndTags in pipelines/queries.ts).
    const profileIds = rows.map((r) => r.id);
    const sectorsByProfile = new Map<string, string[]>();
    if (profileIds.length > 0) {
      const { data: userSectors } = await ctx.supabase
        .from("user_sectors")
        .select("profile_id, sector_id")
        .in("profile_id", profileIds);
      for (const row of (userSectors ?? []) as { profile_id: string; sector_id: string }[]) {
        const bucket = sectorsByProfile.get(row.profile_id) ?? [];
        bucket.push(row.sector_id);
        sectorsByProfile.set(row.profile_id, bucket);
      }
    }

    // Nav-visibility overrides (migration 079) — same batch shape as
    // sectors above, scoped to `comercial:*:view` permissions only (the
    // sidebar-visibility feature's slice of user_permission_overrides;
    // other environments/modules aren't this endpoint's concern).
    const navOverridesByProfile = new Map<string, Record<string, boolean>>();
    if (profileIds.length > 0) {
      const { data: overrides } = await ctx.supabase
        .from("user_permission_overrides")
        .select("profile_id, granted, permissions!inner(module, environment, action)")
        .in("profile_id", profileIds)
        .eq("permissions.environment", "comercial")
        .eq("permissions.action", "view");
      for (const row of (overrides ?? []) as unknown as {
        profile_id: string;
        granted: boolean;
        permissions: { module: string } | { module: string }[];
      }[]) {
        // Supabase's embed typing for this relation isn't reliably a
        // single object vs. an array across environments — handle both.
        const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
        if (!perm) continue;
        const bucket = navOverridesByProfile.get(row.profile_id) ?? {};
        bucket[perm.module] = row.granted;
        navOverridesByProfile.set(row.profile_id, bucket);
      }
    }

    const members: AccountMember[] = rows.flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          role_id: row.role_id,
          sector_ids: sectorsByProfile.get(row.id) ?? [],
          nav_overrides: navOverridesByProfile.get(row.id) ?? {},
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
