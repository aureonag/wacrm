// GET  /api/operational/ops-clients?status=active|inactive|all — clients of
//      the operation with how many projects / tasks each has.
// POST /api/operational/ops-clients — register a client (edit_boards).
//
// Uses the caller's own session (RLS, migration 106), never the service role.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import {
  countTasks,
  EMPTY_COUNTS,
  parseClientInput,
  todayInSaoPaulo,
  ValidationError,
} from "@/lib/operational/clients-projects";

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const status = new URL(req.url).searchParams.get("status") ?? "active";

    let q = ctx.supabase
      .from("ops_clients")
      .select("id, name, code, status, contract_id, created_at")
      .eq("account_id", ctx.accountId)
      .order("name", { ascending: true });
    if (status === "active" || status === "inactive") q = q.eq("status", status);

    const [clients, projects, tasks] = await Promise.all([
      q,
      ctx.supabase.from("ops_projects").select("id, client_id, status").eq("account_id", ctx.accountId),
      ctx.supabase
        .from("tasks")
        .select("project_id, status, due_date")
        .eq("account_id", ctx.accountId)
        .not("project_id", "is", null),
    ]);
    for (const r of [clients, projects, tasks]) {
      if (r.error) {
        console.error("[GET ops-clients]", r.error.message);
        return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
      }
    }

    const clientOf = new Map((projects.data ?? []).map((p) => [p.id as string, p.client_id as string]));
    const byClient = countTasks(
      (tasks.data ?? [])
        .filter((t) => clientOf.has(t.project_id as string))
        .map((t) => ({ key: clientOf.get(t.project_id as string)!, status: t.status as string, due_date: t.due_date as string | null })),
      todayInSaoPaulo(),
    );
    const projectCount = new Map<string, number>();
    for (const p of projects.data ?? []) {
      if (p.status === "active") projectCount.set(p.client_id as string, (projectCount.get(p.client_id as string) ?? 0) + 1);
    }

    return NextResponse.json({
      clients: (clients.data ?? []).map((c) => ({
        ...c,
        projects: projectCount.get(c.id as string) ?? 0,
        tasks: byClient.get(c.id as string) ?? EMPTY_COUNTS,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const input = parseClientInput(await req.json().catch(() => null));
    const { data, error } = await ctx.supabase
      .from("ops_clients")
      .insert({ ...input, account_id: ctx.accountId, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Já existe um cliente com este nome." }, { status: 409 });
      console.error("[POST ops-clients]", error.message);
      return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
