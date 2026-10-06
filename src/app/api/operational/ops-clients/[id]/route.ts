// GET   /api/operational/ops-clients/:id — one client with its projects and
//       how many tasks each project has (total / open / done / overdue).
// PATCH /api/operational/ops-clients/:id — edit the client, or switch it
//       between active and inactive (history is kept either way).

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

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const client = await ctx.supabase
      .from("ops_clients")
      .select("id, name, code, status, notes, contract_id, created_at")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (client.error) {
      console.error("[GET ops-clients/:id]", client.error.message);
      return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const projects = await ctx.supabase
      .from("ops_projects")
      .select("id, name, description, status, start_date, due_date, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: true });
    if (projects.error) return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });

    const ids = (projects.data ?? []).map((p) => p.id as string);
    const tasks = ids.length
      ? await ctx.supabase.from("tasks").select("project_id, status, due_date").in("project_id", ids)
      : { data: [], error: null };
    if (tasks.error) return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });

    const counts = countTasks(
      (tasks.data ?? []).map((t) => ({ key: t.project_id as string, status: t.status as string, due_date: t.due_date as string | null })),
      todayInSaoPaulo(),
    );
    return NextResponse.json({
      client: client.data,
      projects: (projects.data ?? []).map((p) => ({ ...p, tasks: counts.get(p.id as string) ?? EMPTY_COUNTS })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseClientInput(await req.json().catch(() => null), true);
    if (Object.keys(input).length === 0) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("ops_clients")
      .update(input)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Já existe um cliente com este nome." }, { status: 409 });
      console.error("[PATCH ops-clients/:id]", error.message);
      return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
