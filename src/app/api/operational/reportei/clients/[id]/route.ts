// GET /api/operational/reportei/clients/:id — one client with its report
// preferences and the ad accounts linked to it (the Reportei client page).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [client, settings, integrations] = await Promise.all([
      ctx.supabase.from("ops_clients").select("id, name, code, status").eq("id", id).eq("account_id", ctx.accountId).maybeSingle(),
      ctx.supabase
        .from("reportei_client_settings")
        .select("locale, date_format, decimal_format")
        .eq("client_id", id)
        .eq("account_id", ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from("ad_integrations")
        .select("id, provider, external_account_id, external_account_name, status, last_error, last_synced_at, created_at")
        .eq("client_id", id)
        .eq("account_id", ctx.accountId)
        .order("created_at", { ascending: true }),
    ]);
    for (const r of [client, settings, integrations]) {
      if (r.error) {
        console.error("[GET reportei/clients/:id]", r.error.message);
        return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
      }
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      client: client.data,
      settings: settings.data ?? { locale: "pt-BR", date_format: "DD/MM/YYYY", decimal_format: "comma" },
      integrations: integrations.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
