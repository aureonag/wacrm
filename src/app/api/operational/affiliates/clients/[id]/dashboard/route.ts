// GET /api/operational/affiliates/clients/:id/dashboard — numbers for the
// per-client Dashboard (Atenção ao programa, Resultados, Comissões,
// Desempenho dos parceiros, Comissões recentes). Read only.
//
// Everything is computed from the real aff_* tables of that client. Orders are
// still samples until the store integration exists, so "Resultados" is empty
// for a client with no orders.
//
// Staff only (owner/admin) — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireStaff } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";

const RECENT = 8;
const TOP_PARTNERS = 8;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireStaff();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [client, commissions, memberships, orders] = await Promise.all([
      admin.from("aff_clients").select("id, name, status").eq("id", id).neq("status", "removed").maybeSingle(),
      admin
        .from("aff_commissions")
        .select("id, affiliate_id, period, gross_cents, status, invoice_number, created_at, aff_affiliates(name)")
        .eq("client_id", id)
        .order("period", { ascending: false })
        .order("created_at", { ascending: false }),
      admin.from("aff_memberships").select("id, affiliate_id, code, status").eq("client_id", id),
      admin.from("aff_orders").select("affiliate_id, total_cents, status").eq("client_id", id),
    ]);

    for (const r of [client, commissions, memberships, orders]) {
      if (r.error) {
        if (isModuleNotReady(r.error)) return moduleNotReadyResponse();
        console.error("[GET affiliates/dashboard]", r.error.message);
        return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
      }
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const comms = (commissions.data ?? []) as unknown as {
      id: string;
      affiliate_id: string;
      period: string;
      gross_cents: number;
      status: string;
      invoice_number: string | null;
      aff_affiliates: { name: string } | null;
    }[];
    const members = memberships.data ?? [];
    const paidOrders = (orders.data ?? []).filter((o) => o.status === "paid");

    const sumGross = (status?: string) =>
      comms.filter((c) => !status || c.status === status).reduce((n, c) => n + Number(c.gross_cents), 0);
    const count = (...statuses: string[]) => comms.filter((c) => statuses.includes(c.status)).length;

    // Participant code per affiliate (first approved membership) for the table.
    const codeOf = new Map<string, string>();
    for (const m of members) if (!codeOf.has(m.affiliate_id)) codeOf.set(m.affiliate_id, m.code);

    // Paid sales per approved affiliate, biggest first.
    const salesBy = new Map<string, number>();
    for (const o of paidOrders) salesBy.set(o.affiliate_id, (salesBy.get(o.affiliate_id) ?? 0) + Number(o.total_cents));
    const nameOf = new Map<string, string>();
    for (const c of comms) if (c.aff_affiliates) nameOf.set(c.affiliate_id, c.aff_affiliates.name);
    const missing = [...salesBy.keys()].filter((aid) => !nameOf.has(aid));
    if (missing.length > 0) {
      const { data } = await admin.from("aff_affiliates").select("id, name").in("id", missing);
      for (const a of data ?? []) nameOf.set(a.id, a.name);
    }
    const partners = [...salesBy.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_PARTNERS)
      .map(([affiliateId, cents]) => ({ affiliate_id: affiliateId, name: nameOf.get(affiliateId) ?? "—", sales_cents: cents }));

    return NextResponse.json({
      client: { id: client.data.id, name: client.data.name, status: client.data.status },
      attention: {
        awaiting_invoice: count("awaiting_invoice", "invoice_rejected"),
        invoice_review: count("invoice_review"),
        available: count("available"),
        pending_affiliates: members.filter((m) => m.status === "pending").length,
      },
      results: {
        paid_sales_cents: paidOrders.reduce((n, o) => n + Number(o.total_cents), 0),
        paid_orders: paidOrders.length,
        affiliates: new Set(members.filter((m) => m.status === "approved").map((m) => m.affiliate_id)).size,
      },
      commissions: {
        accrued_cents: sumGross(),
        available_cents: sumGross("available"),
        paid_cents: sumGross("paid_external"),
      },
      partners,
      recent: comms.slice(0, RECENT).map((c) => ({
        id: c.id,
        affiliate_name: c.aff_affiliates?.name ?? "—",
        code: codeOf.get(c.affiliate_id) ?? null,
        period: c.period,
        gross_cents: Number(c.gross_cents),
        status: c.status,
        invoice_number: c.invoice_number,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
