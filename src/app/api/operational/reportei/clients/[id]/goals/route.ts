// /api/operational/reportei/clients/:id/goals
//   GET → { goals: { monthlyBudget, maxCpc } } (view_tasks)
//   PUT { monthlyBudget, maxCpc } → set or clear the goals (edit_boards);
//        both empty removes the row.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { goalsFromRow, parseGoals } from "@/lib/reportei/goals";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await ctx.supabase.from("reportei_client_goals").select("monthly_budget, max_cpc").eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (error) {
      console.error("[GET reportei goals]", error.message);
      return NextResponse.json({ error: "Failed to load goals" }, { status: 500 });
    }
    return NextResponse.json({ goals: goalsFromRow(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const goals = parseGoals(await req.json().catch(() => null));
    if (!goals) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (goals.monthlyBudget === null && goals.maxCpc === null) {
      const { error } = await ctx.supabase.from("reportei_client_goals").delete().eq("client_id", id).eq("account_id", ctx.accountId);
      if (error) {
        console.error("[PUT reportei goals] clear", error.message);
        return NextResponse.json({ error: "Failed to save goals" }, { status: 500 });
      }
      return NextResponse.json({ goals });
    }

    const { error } = await ctx.supabase
      .from("reportei_client_goals")
      .upsert({ client_id: id, account_id: ctx.accountId, monthly_budget: goals.monthlyBudget, max_cpc: goals.maxCpc, updated_by: ctx.userId }, { onConflict: "client_id" });
    if (error) {
      console.error("[PUT reportei goals]", error.message);
      return NextResponse.json({ error: "Failed to save goals" }, { status: 500 });
    }
    return NextResponse.json({ goals });
  } catch (err) {
    return toErrorResponse(err);
  }
}
