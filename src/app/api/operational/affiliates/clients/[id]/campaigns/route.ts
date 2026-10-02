// GET  /api/operational/affiliates/clients/:id/campaigns — campaigns of one client.
// POST /api/operational/affiliates/clients/:id/campaigns — create a campaign.
//
// Staff only (owner/admin) — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import {
  BadInput,
  isModuleNotReady,
  moduleNotReadyResponse,
  requireStaff,
  writeAudit,
} from "@/lib/affiliates/admin";
import { isUuid, parseCampaignInput } from "@/lib/affiliates/campaigns";

const COLUMNS =
  "id, client_id, name, description, policy, discount_type, discount, frequency, start_date, end_date, rewards, status, revision, history, created_at, updated_at";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireStaff();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [campaigns, memberships] = await Promise.all([
      admin.from("aff_campaigns").select(COLUMNS).eq("client_id", id).order("created_at", { ascending: false }),
      admin.from("aff_memberships").select("campaign_id").eq("client_id", id).in("status", ["pending", "approved"]),
    ]);
    if (campaigns.error) {
      if (isModuleNotReady(campaigns.error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/campaigns]", campaigns.error.message);
      return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
    }

    const counts = new Map<string, number>();
    for (const m of memberships.data ?? []) counts.set(m.campaign_id, (counts.get(m.campaign_id) ?? 0) + 1);

    return NextResponse.json({
      campaigns: (campaigns.data ?? []).map((c) => ({ ...c, participants: counts.get(c.id) ?? 0 })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseCampaignInput(await req.json().catch(() => null));

    const client = await admin.from("aff_clients").select("id").eq("id", id).neq("status", "removed").maybeSingle();
    if (client.error) {
      if (isModuleNotReady(client.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
    }
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await admin
      .from("aff_campaigns")
      .insert({ ...input, client_id: id })
      .select("id")
      .single();
    if (error) {
      console.error("[POST affiliates/campaigns]", error.message);
      return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
    }

    await writeAudit(admin, ctx, { clientId: id, action: "Criou campanha", objectType: "campaign", objectId: data.id });
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
