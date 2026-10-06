// GET /api/operational/affiliates/clients/:id/reports — the Relatórios screen:
// attributed orders and the account history (aff_audit). Read only.
// The CSV of approved payments is the existing /commissions/export route.
//
// Staff only (owner/admin) — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireStaff } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";

const ORDERS_LIMIT = 100;
const AUDIT_LIMIT = 40;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireStaff();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [orders, audit] = await Promise.all([
      admin
        .from("aff_orders")
        .select("id, external_id, total_cents, status, ordered_at, aff_affiliates(name), aff_memberships(code)")
        .eq("client_id", id)
        .order("ordered_at", { ascending: false })
        .limit(ORDERS_LIMIT),
      admin
        .from("aff_audit")
        .select("id, action, actor_name, actor_kind, created_at")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(AUDIT_LIMIT),
    ]);
    for (const r of [orders, audit]) {
      if (r.error) {
        if (isModuleNotReady(r.error)) return moduleNotReadyResponse();
        console.error("[GET affiliates/reports]", r.error.message);
        return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
      }
    }

    const orderRows = (orders.data ?? []) as unknown as {
      id: string;
      external_id: string | null;
      total_cents: number;
      status: "paid" | "cancelled" | "pending";
      ordered_at: string;
      aff_affiliates: { name: string } | null;
      aff_memberships: { code: string } | null;
    }[];

    return NextResponse.json({
      orders: orderRows.map((o) => ({
        id: o.id,
        code: o.external_id,
        affiliate_name: o.aff_affiliates?.name ?? "—",
        coupon: o.aff_memberships?.code ?? null,
        total_cents: Number(o.total_cents),
        status: o.status,
        ordered_at: o.ordered_at,
      })),
      audit: audit.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
