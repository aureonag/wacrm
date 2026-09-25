// GET /api/operational/tasks/[id]/contract — the "Contrato" card of a
// kickoff task: who signed and WHAT was contracted, never how much.
//
// Operacional must never see contract values (see project rule). The
// contract itself is not readable by them, so this route reads it with
// the service role and returns only an allow-list: company, CNPJ,
// signature/cancellation dates and the four scope sections from
// extractScopeSections (which also drops any line that looks like a price).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { extractScopeSections } from "@/lib/contracts/scope";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission("operational", "tasks", "view_tasks");

    const { data: task } = await ctx.supabase
      .from("tasks")
      .select("id, deal_id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!task.deal_id) return NextResponse.json({ contract: null });

    const { data: contract } = await supabaseAdmin()
      .from("deal_contracts")
      .select("razao_social, cnpj, signed_at, terminated_at, termination_effective_date, rendered_content")
      .eq("deal_id", task.deal_id)
      .eq("account_id", ctx.accountId)
      .eq("status", "signed")
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!contract) return NextResponse.json({ contract: null });

    return NextResponse.json({
      contract: {
        razaoSocial: contract.razao_social,
        cnpj: contract.cnpj,
        signedAt: contract.signed_at,
        terminatedAt: contract.terminated_at,
        terminationEffectiveDate: contract.termination_effective_date,
        sections: extractScopeSections(contract.rendered_content as string | null),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
