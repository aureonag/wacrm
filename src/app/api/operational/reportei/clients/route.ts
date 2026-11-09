// GET  /api/operational/reportei/clients?status=active|inactive|all — the client cards:
//      logo, networks linked, connection health, report count and last report (view_tasks).
// POST /api/operational/reportei/clients — "Novo cliente" step 1: registers the
// client (ops_clients) together with its report preferences
// (reportei_client_settings, migration 158). Needs edit_boards, same as
// registering a client in Operacional → Clientes. Uses the caller's own
// session (RLS), never the service role.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { ValidationError } from "@/lib/operational/clients-projects";
import { healthOf, networksOf, reportStatsByClient, type ClientCardData } from "@/lib/reportei/client-card";
import { parseReporteiClientInput } from "@/lib/reportei/client-settings";

export async function GET(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const status = new URL(req.url).searchParams.get("status") ?? "active";

    let q = ctx.supabase.from("ops_clients").select("id, name, code, status").eq("account_id", ctx.accountId).order("name", { ascending: true });
    if (status === "active" || status === "inactive") q = q.eq("status", status);
    const [clients, logos, reports, integrations] = await Promise.all([
      q,
      ctx.supabase.from("reportei_client_logos").select("client_id, logo_url").eq("account_id", ctx.accountId),
      ctx.supabase.from("reportei_reports").select("client_id, created_at").eq("account_id", ctx.accountId).order("created_at", { ascending: false }).limit(10000),
      ctx.supabase.from("ad_integrations").select("client_id, provider, status").eq("account_id", ctx.accountId).limit(10000),
    ]);
    for (const r of [clients, logos, reports, integrations]) {
      if (r.error) {
        console.error("[GET reportei/clients]", r.error.message);
        return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
      }
    }

    const logoOf = new Map((logos.data ?? []).map((l) => [l.client_id as string, l.logo_url as string]));
    const stats = reportStatsByClient((reports.data ?? []).map((r) => ({ client_id: r.client_id as string, created_at: r.created_at as string })));
    const linked = new Map<string, { providers: string[]; statuses: string[] }>();
    for (const i of integrations.data ?? []) {
      const cur = linked.get(i.client_id as string) ?? { providers: [], statuses: [] };
      cur.providers.push(i.provider as string);
      cur.statuses.push(i.status as string);
      linked.set(i.client_id as string, cur);
    }

    const cards: ClientCardData[] = (clients.data ?? []).map((c) => {
      const l = linked.get(c.id as string);
      const s = stats.get(c.id as string);
      return {
        id: c.id as string,
        name: c.name as string,
        code: (c.code as string | null) ?? null,
        status: c.status as "active" | "inactive",
        logoUrl: logoOf.get(c.id as string) ?? null,
        networks: networksOf(l?.providers ?? []),
        health: healthOf(l?.statuses ?? []),
        reportCount: s?.count ?? 0,
        lastReportAt: s?.last ?? null,
      };
    });
    return NextResponse.json({ clients: cards });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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
