// GET /api/operational/clients — "Clientes ativos" for Operacional: every
// signed, not-cancelled contract with WHAT was contracted (scope sections)
// and how many open tasks the client has. Never returns any price — same
// allow-list as the task contract card (see task contract route).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { extractScopeSections } from "@/lib/contracts/scope";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const admin = supabaseAdmin();

    const { data: contracts, error } = await admin
      .from("deal_contracts")
      .select("id, deal_id, razao_social, cnpj, signed_at, rendered_content, deal:deals(contact_id), template:contract_templates(name)")
      .eq("account_id", ctx.accountId)
      .eq("status", "signed")
      .is("terminated_at", null)
      .order("signed_at", { ascending: false });
    if (error) {
      console.error("[GET /api/operational/clients] contracts error:", error.message);
      return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
    }

    const { data: openTasks } = await admin
      .from("tasks")
      .select("contact_id, deal_id")
      .eq("account_id", ctx.accountId)
      .eq("status", "open");

    const byContact = new Map<string, number>();
    const byDeal = new Map<string, number>();
    for (const t of openTasks ?? []) {
      if (t.contact_id) byContact.set(t.contact_id as string, (byContact.get(t.contact_id as string) ?? 0) + 1);
      if (t.deal_id && t.deal_id !== null) byDeal.set(t.deal_id as string, (byDeal.get(t.deal_id as string) ?? 0) + 1);
    }

    const clients = [];
    // One row per signed contract: a client with two fronts shows both.
    for (const c of contracts ?? []) {
      const deal = (Array.isArray(c.deal) ? c.deal[0] : c.deal) as { contact_id: string | null } | null;
      const contactId = deal?.contact_id ?? null;
      const contactTasks = contactId ? (byContact.get(contactId) ?? 0) : 0;
      const dealOnlyTasks = byDeal.get(c.deal_id as string) ?? 0;
      clients.push({
        id: c.id,
        title: ((Array.isArray(c.template) ? c.template[0] : c.template) as { name?: string | null } | null)?.name ?? null,
        razaoSocial: c.razao_social,
        cnpj: c.cnpj,
        signedAt: c.signed_at,
        openTasks: Math.max(contactTasks, dealOnlyTasks),
        sections: extractScopeSections(c.rendered_content as string | null),
      });
    }

    return NextResponse.json({ clients });
  } catch (err) {
    return toErrorResponse(err);
  }
}
