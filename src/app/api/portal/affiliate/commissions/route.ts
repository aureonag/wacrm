// GET /api/portal/affiliate/commissions — the logged-in affiliate's commissions
// (all stores). Same shape as the staff list, plus the store name.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireAffiliate } from "@/lib/affiliates/portal";
import { COMMISSION_COLUMNS } from "@/lib/affiliates/commissions-server";

export async function GET() {
  try {
    const { admin, affiliate } = await requireAffiliate();
    const { data, error } = await admin
      .from("aff_commissions")
      .select(`${COMMISSION_COLUMNS}, aff_clients(name, status)`)
      .eq("affiliate_id", affiliate.id)
      .order("period", { ascending: false });
    if (error) {
      console.error("[GET portal/commissions]", error.message);
      return NextResponse.json({ error: "Failed to load" }, { status: 500 });
    }
    type Row = Record<string, unknown> & { aff_clients: { name: string; status: string } | null };
    return NextResponse.json({
      commissions: ((data ?? []) as unknown as Row[])
        .filter((r) => r.aff_clients && r.aff_clients.status !== "removed")
        .map(({ aff_clients, ...rest }) => ({ ...rest, store: aff_clients!.name })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
