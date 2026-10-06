// GET   /api/operational/affiliates/clients/:id/campaigns/:campaignId
// PATCH body { status: 'active' | 'inactive' }  → activate / deactivate
// PATCH body { name, description, policy, discount, rewards, revision }
//       → edit. Type of discount, frequency and dates are fixed at creation.
//       A change to policy / discount / rewards bumps `revision` and keeps the
//       previous version in `history`, so commissions already closed under an
//       older rule stay explainable.
//
// Aureon staff, or a store user with the right permission — see requireClientAccess in src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import {
  BadInput,
  isModuleNotReady,
  moduleNotReadyResponse,
  requireClientAccess,
  writeAudit,
} from "@/lib/affiliates/admin";
import { isUuid, parseCampaignInput, type Campaign, type CampaignHistoryEntry } from "@/lib/affiliates/campaigns";

const COLUMNS =
  "id, client_id, name, description, policy, discount_type, discount, frequency, start_date, end_date, rewards, status, revision, history, created_at, updated_at";

type Ctx = { params: Promise<{ id: string; campaignId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id, campaignId } = await params;
    if (!isUuid(id) || !isUuid(campaignId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin } = await requireClientAccess(id, [["campaigns", "view"]]);

    const { data, error } = await admin
      .from("aff_campaigns")
      .select(COLUMNS)
      .eq("id", campaignId)
      .eq("client_id", id)
      .maybeSingle();
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/campaigns/:id]", error.message);
      return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ campaign: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id, campaignId } = await params;
    if (!isUuid(id) || !isUuid(campaignId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["campaigns", "edit"]]);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

    const current = await admin
      .from("aff_campaigns")
      .select(COLUMNS)
      .eq("id", campaignId)
      .eq("client_id", id)
      .maybeSingle();
    if (current.error) {
      if (isModuleNotReady(current.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
    }
    if (!current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = current.data as Campaign;

    let patch: Record<string, unknown>;
    let action: string;
    if (typeof body.status === "string") {
      if (body.status !== "active" && body.status !== "inactive") {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      }
      patch = { status: body.status };
      action = body.status === "active" ? "Ativou campanha" : "Desativou campanha";
    } else {
      if (Number(body.revision) !== existing.revision) {
        return NextResponse.json(
          { error: "A campanha foi alterada por outra pessoa. Recarregue a página e tente de novo." },
          { status: 409 },
        );
      }
      const input = parseCampaignInput({
        ...body,
        discount_type: existing.discount_type,
        frequency: existing.frequency,
        start_date: existing.start_date,
        end_date: existing.end_date,
      });
      const ruleChanged =
        input.policy !== existing.policy ||
        input.discount !== Number(existing.discount) ||
        JSON.stringify(input.rewards) !== JSON.stringify(existing.rewards);

      patch = {
        name: input.name,
        description: input.description,
        policy: input.policy,
        discount: input.discount,
        rewards: input.rewards,
      };
      if (ruleChanged) {
        const entry: CampaignHistoryEntry = {
          revision: existing.revision,
          changed_at: new Date().toISOString(),
          changed_by: ctx.userId,
          policy: existing.policy,
          discount: Number(existing.discount),
          rewards: existing.rewards,
        };
        patch.revision = existing.revision + 1;
        patch.history = [...existing.history, entry];
      }
      action = ruleChanged ? "Editou regras da campanha" : "Editou campanha";
    }

    const { data, error } = await admin
      .from("aff_campaigns")
      .update(patch)
      .eq("id", campaignId)
      .eq("client_id", id)
      .eq("revision", existing.revision)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[PATCH affiliates/campaigns/:id]", error.message);
      return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "A campanha foi alterada por outra pessoa. Recarregue a página e tente de novo." },
        { status: 409 },
      );
    }

    await writeAudit(admin, ctx, { clientId: id, action, objectType: "campaign", objectId: campaignId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
