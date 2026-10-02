// GET /api/public/affiliates/campaigns/:id — public campaign page data.
//
// No auth. Returns ONLY what the sign-up page needs (store name, rules, rewards,
// current policy + revision) — never client contacts, ids of other records, etc.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/affiliates/portal";
import { isUuid } from "@/lib/affiliates/campaigns";

interface CampaignRow {
  id: string;
  name: string;
  description: string;
  policy: string;
  discount_type: string;
  discount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  rewards: unknown;
  status: string;
  revision: number;
  aff_clients: { name: string; status: string } | null;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit(`aff-peek:${clientIp(request)}`, RATE_LIMITS.affiliatePeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabaseAdmin()
    .from("aff_campaigns")
    .select(
      "id, name, description, policy, discount_type, discount, frequency, start_date, end_date, rewards, status, revision, aff_clients(name, status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[GET public/affiliates/campaigns]", error.message);
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
  const c = data as unknown as CampaignRow | null;
  if (!c || !c.aff_clients || c.aff_clients.status === "removed") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const open = c.status === "active" && c.aff_clients.status === "active" && (!c.end_date || today() <= c.end_date);
  return NextResponse.json({
    campaign: {
      id: c.id,
      store: c.aff_clients.name,
      name: c.name,
      description: c.description,
      policy: c.policy,
      discount_type: c.discount_type,
      discount: Number(c.discount),
      frequency: c.frequency,
      start_date: c.start_date,
      end_date: c.end_date,
      rewards: c.rewards,
      revision: c.revision,
      open,
    },
  });
}
