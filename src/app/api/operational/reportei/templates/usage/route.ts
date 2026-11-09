// GET /api/operational/reportei/templates/usage → { usage: { [templateId]: number } }
// How many reports were generated from each template ("builtin:…" or a saved one).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .select("template_id")
      .eq("account_id", ctx.accountId)
      .not("template_id", "is", null)
      .limit(10000);
    if (error) {
      console.error("[GET reportei/templates/usage]", error.message);
      return NextResponse.json({ error: "Failed to load usage" }, { status: 500 });
    }
    const usage: Record<string, number> = {};
    for (const r of data ?? []) {
      const id = r.template_id as string;
      usage[id] = (usage[id] ?? 0) + 1;
    }
    return NextResponse.json({ usage });
  } catch (err) {
    return toErrorResponse(err);
  }
}
