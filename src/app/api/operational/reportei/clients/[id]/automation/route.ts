// /api/operational/reportei/clients/:id/automation
//   GET → the client's automation (or null) and the last report it generated
//   PUT { frequency, active } → create or change it (edit_boards)

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { isFrequency } from "@/lib/reportei/automation";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
type Ctx = { params: Promise<{ id: string }> };

const COLUMNS = "id, frequency, active, last_run_on, last_error, last_report_id, created_at";

type Row = { id: string; frequency: string; active: boolean; last_run_on: string | null; last_error: string | null; last_report_id: string | null };

async function shape(supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"], accountId: string, row: Row) {
  let lastReport: { id: string; title: string; shareToken: string | null; createdAt: string } | null = null;
  if (row.last_report_id) {
    const { data } = await supabase
      .from("reportei_reports")
      .select("id, title, share_token, created_at")
      .eq("id", row.last_report_id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (data) lastReport = { id: data.id, title: data.title, shareToken: data.share_token ?? null, createdAt: data.created_at };
  }
  return { id: row.id, frequency: row.frequency, active: row.active, lastRunOn: row.last_run_on, lastError: row.last_error, lastReport };
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase.from("reportei_automations").select(COLUMNS).eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (error) {
      console.error("[GET reportei automation]", error.message);
      return NextResponse.json({ error: "Failed to load automation" }, { status: 500 });
    }
    return NextResponse.json({ automation: data ? await shape(ctx.supabase, ctx.accountId, data as Row) : null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { frequency?: unknown; active?: unknown } | null;
    if (!isFrequency(body?.frequency) || typeof body?.active !== "boolean") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Changing only the frequency or the switch keeps the run history.
    const { data, error } = await ctx.supabase
      .from("reportei_automations")
      .upsert(
        { account_id: ctx.accountId, client_id: id, frequency: body.frequency, active: body.active, created_by: ctx.userId },
        { onConflict: "client_id" },
      )
      .select(COLUMNS)
      .single();
    if (error || !data) {
      console.error("[PUT reportei automation]", error?.message);
      return NextResponse.json({ error: "Failed to save automation" }, { status: 500 });
    }
    return NextResponse.json({ automation: await shape(ctx.supabase, ctx.accountId, data as Row) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
