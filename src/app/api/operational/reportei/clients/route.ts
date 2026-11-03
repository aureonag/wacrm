// POST /api/operational/reportei/clients — "Novo cliente" step 1: registers the
// client (ops_clients) together with its report preferences
// (reportei_client_settings, migration 158). Needs edit_boards, same as
// registering a client in Operacional → Clientes. Uses the caller's own
// session (RLS), never the service role.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { ValidationError } from "@/lib/operational/clients-projects";
import { parseReporteiClientInput } from "@/lib/reportei/client-settings";

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const input = parseReporteiClientInput(await req.json().catch(() => null));

    const created = await ctx.supabase
      .from("ops_clients")
      .insert({ name: input.name, code: input.code, account_id: ctx.accountId, created_by: ctx.userId })
      .select("id")
      .single();
    if (created.error) {
      if (created.error.code === "23505") return NextResponse.json({ error: "Já existe um cliente com este nome." }, { status: 409 });
      console.error("[POST reportei/clients]", created.error.message);
      return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
    }

    const settings = await ctx.supabase.from("reportei_client_settings").insert({
      client_id: created.data.id,
      account_id: ctx.accountId,
      locale: input.locale,
      date_format: input.dateFormat,
      decimal_format: input.decimalFormat,
    });
    if (settings.error) {
      // Do not leave a client behind without its preferences: undo the first insert.
      console.error("[POST reportei/clients] settings:", settings.error.message);
      await ctx.supabase.from("ops_clients").delete().eq("id", created.data.id).eq("account_id", ctx.accountId);
      return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
    }

    return NextResponse.json({ id: created.data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
