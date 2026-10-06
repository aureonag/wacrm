// GET /api/operational/affiliates/clients/:id/affiliates/ranking?month=YYYY-MM&campaign=<id>
// Ranking of the approved participants of a client by paid sales in a month
// (Brasília time). Everyone approved is listed, with zero when they sold nothing.
// Cancelled orders are counted apart and never add to the ranking.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  // Sao Paulo has no DST since 2019: a fixed -03:00 offset is exact for any current month.
  return { from: `${month}-01T00:00:00-03:00`, to: `${next}-01T00:00:00-03:00` };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin } = await requireClientAccess(id, [["affiliates", "view"]]);

    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const campaign = url.searchParams.get("campaign");
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Competência inválida." }, { status: 400 });
    if (campaign && !isUuid(campaign)) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
    const { from, to } = monthRange(month);

    let members = admin
      .from("aff_memberships")
      .select("id, code, campaign_id, affiliate_id, aff_campaigns(name), aff_affiliates(name)")
      .eq("client_id", id)
      .eq("status", "approved");
    if (campaign) members = members.eq("campaign_id", campaign);

    const [memberRes, orderRes] = await Promise.all([
      members,
      admin
        .from("aff_orders")
        .select("membership_id, total_cents, status")
        .eq("client_id", id)
        .gte("ordered_at", from)
        .lt("ordered_at", to),
    ]);
    for (const r of [memberRes, orderRes]) {
      if (r.error) {
        if (isModuleNotReady(r.error)) return moduleNotReadyResponse();
        console.error("[GET affiliates/ranking]", r.error.message);
        return NextResponse.json({ error: "Failed to load ranking" }, { status: 500 });
      }
    }

    const agg = new Map<string, { sales: number; orders: number; cancelled: number }>();
    for (const o of orderRes.data ?? []) {
      const a = agg.get(o.membership_id) ?? { sales: 0, orders: 0, cancelled: 0 };
      if (o.status === "paid") {
        a.sales += Number(o.total_cents);
        a.orders += 1;
      } else if (o.status === "cancelled") {
        a.cancelled += 1;
      }
      agg.set(o.membership_id, a);
    }

    const rows = (
      (memberRes.data ?? []) as unknown as {
        id: string;
        code: string;
        campaign_id: string;
        aff_campaigns: { name: string } | null;
        aff_affiliates: { name: string } | null;
      }[]
    )
      .map((m) => {
        const a = agg.get(m.id) ?? { sales: 0, orders: 0, cancelled: 0 };
        return {
          membership_id: m.id,
          name: m.aff_affiliates?.name ?? "—",
          code: m.code,
          campaign_id: m.campaign_id,
          campaign_name: m.aff_campaigns?.name ?? "",
          sales_cents: a.sales,
          orders: a.orders,
          cancelled: a.cancelled,
        };
      })
      .sort((x, y) => y.sales_cents - x.sales_cents || x.name.localeCompare(y.name, "pt-BR"));

    return NextResponse.json({ month, ranking: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
