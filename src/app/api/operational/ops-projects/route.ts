// GET /api/operational/ops-projects — flat list of the ACTIVE projects of
// ACTIVE clients ("Cliente — Projeto"), for the project picker on a task.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { data, error } = await ctx.supabase
      .from("ops_projects")
      .select("id, name, client_id, ops_clients!inner(name, status)")
      .eq("account_id", ctx.accountId)
      .eq("status", "active")
      .eq("ops_clients.status", "active");
    if (error) {
      console.error("[GET ops-projects]", error.message);
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
    }
    const rows = ((data ?? []) as unknown as { id: string; name: string; client_id: string; ops_clients: { name: string } }[])
      .map((p) => ({ id: p.id, name: p.name, client_id: p.client_id, client_name: p.ops_clients.name }))
      .sort((a, b) => a.client_name.localeCompare(b.client_name, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
    return NextResponse.json({ projects: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
