// POST /api/operational/ops-clients/:id/projects — new project of a client.
// An inactive client does not receive new projects (reactivate it first).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseProjectInput, ValidationError } from "@/lib/operational/clients-projects";

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseProjectInput(await req.json().catch(() => null));

    const client = await ctx.supabase
      .from("ops_clients")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (client.data.status !== "active") {
      return NextResponse.json({ error: "Reative o cliente antes de criar projetos." }, { status: 409 });
    }

    const { data, error } = await ctx.supabase
      .from("ops_projects")
      .insert({ ...input, client_id: id, account_id: ctx.accountId, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) {
      console.error("[POST ops-clients/:id/projects]", error.message);
      return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
