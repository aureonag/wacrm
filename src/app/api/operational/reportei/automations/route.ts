// GET /api/operational/reportei/automations — every client's automation, for the
// Automações screen (view_tasks).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { data, error } = await ctx.supabase
      .from("reportei_automations")
      .select("id, client_id, frequency, active, last_run_on, last_error, last_report_id, ops_clients(name, code)")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[GET reportei/automations]", error.message);
      return NextResponse.json({ error: "Failed to load automations" }, { status: 500 });
    }
    const automations = (data ?? []).map((a) => {
      const client = Array.isArray(a.ops_clients) ? a.ops_clients[0] : a.ops_clients;
      return {
        id: a.id,
        clientId: a.client_id,
        clientName: client?.name ?? "",
        clientCode: client?.code ?? null,
        frequency: a.frequency,
        active: a.active,
        lastRunOn: a.last_run_on,
        lastError: a.last_error,
        lastReportId: a.last_report_id,
      };
    });
    return NextResponse.json({ automations });
  } catch (err) {
    return toErrorResponse(err);
  }
}
