// POST /api/operational/reportei/reports/generate — "Concluir e gerar relatório" of the
// new-report form: a report made from a template, for the integrations chosen.
//   { clientId, templateId, period, compare, integrations: [{ network, account, accountId?, campaigns? }], demo? }
//   Meta Ads accounts are chosen by `accountId` (act_…), which must be linked to the client; the
//   `account` text is only a label and never selects anything. `campaigns`: absent/null = the whole
//   account, otherwise a non-empty list of campaign ids that exist in that account; anything else is
//   refused (400) instead of being read as "the whole account".
//   templateId: "builtin:…" (Reportei's four) or the id of a saved template.
//   period: a preset of the form or { since, until }; compare: "previous" | "none" | { since, until }.
// The numbers are the REAL ones of the Meta Ads accounts linked to the client: the accounts and
// their campaign filters come from the database (the names the browser sends only say which of
// the linked accounts to use). A network without a real source gets no block and is listed in
// `skipped`; an indicator without data stays in the document as unavailable. Nothing is ever
// made up, except when the body asks for `demo: true`: then the report is a marked model with
// fictitious numbers (the preview), and it cannot be shared.
// → 201 { id, skipped, unreadable }. edit_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { makeId } from "@/lib/reportei/doc";
import { demoSource } from "@/lib/reportei/doc-catalog";
import { buildDocFromTemplate, findBuiltin, type TemplateLayout } from "@/lib/reportei/doc-templates";
import { parseIntegrations } from "@/lib/reportei/generate-input";
import { listCampaigns, MetaAdsError } from "@/lib/reportei/meta-ads";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { buildRealDoc } from "@/lib/reportei/meta-doc";
import { collectAccountSnapshots } from "@/lib/reportei/report-data";
import { resolvePeriod } from "@/lib/reportei/periods";
import { loadTemplate, isUuid } from "@/lib/reportei/template-store";
import { resolveAnalysis, resolveCompare } from "@/lib/reportei/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    if (!isUuid(clientId)) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });

    const today = resolvePeriod("last_7d").until;
    const range = resolveAnalysis(body?.period, today);
    if (!range) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    const compare = resolveCompare(body?.compare ?? "previous", range, today);
    if (compare === undefined) return NextResponse.json({ error: "Invalid compare" }, { status: 400 });
    const integrations = parseIntegrations(body?.integrations);
    if (!integrations) return NextResponse.json({ error: "Invalid integrations" }, { status: 400 });

    const client = await ctx.supabase.from("ops_clients").select("id, name").eq("id", clientId).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const templateId = typeof body?.templateId === "string" ? body.templateId : "";
    let layout: TemplateLayout | null = null;
    if (templateId.startsWith("builtin:")) layout = findBuiltin(templateId)?.layout ?? null;
    else if (isUuid(templateId)) layout = (await loadTemplate(ctx.supabase, ctx.accountId, templateId))?.layout ?? null;
    if (!layout) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    let doc;
    let accountsSnapshot: Awaited<ReturnType<typeof collectAccountSnapshots>> = [];
    let skipped: string[] = [];
    let unreadable: { account: string; error: string }[] = [];
    if (body?.demo === true) {
      // The marked preview: fictitious numbers, flagged in the document.
      const named = integrations.map((i) => ({ network: i.network, account: i.campaigns ? `${i.account} · ${i.campaigns.length} ${i.campaigns.length === 1 ? "campanha" : "campanhas"}` : i.account }));
      doc = buildDocFromTemplate({ layout, integrations: named, range, seed: `${clientId}:${Date.now()}`, source: demoSource }, makeId);
    } else {
      const metaChosen = integrations.filter((i) => i.network === "meta_ads");
      if (metaChosen.length === 0) return NextResponse.json({ error: "no_real_source", skipped: [...new Set(integrations.map((i) => i.network))] }, { status: 422 });
      // Accounts are chosen by id only: a name never selects an account.
      if (metaChosen.some((i) => !i.accountId)) return NextResponse.json({ error: "account_id_required" }, { status: 400 });
      const ids = [...new Set(metaChosen.map((i) => i.accountId as string))];
      const linked = await ctx.supabase.from("ad_integrations").select("external_account_id, connection_id").eq("client_id", clientId).eq("account_id", ctx.accountId).eq("provider", "meta_ads").in("external_account_id", ids);
      if (linked.error) return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });
      const linkedIds = new Set((linked.data ?? []).map((l) => l.external_account_id as string));
      const unknown = ids.filter((x) => !linkedIds.has(x));
      if (unknown.length > 0) return NextResponse.json({ error: "unknown_account", accounts: unknown }, { status: 400 });

      // Chosen campaigns must exist in that account, so a typo is an error and not an empty (or whole-account) read.
      const campaigns: Record<string, string[] | null> = {};
      for (const i of metaChosen) campaigns[i.accountId as string] = i.campaigns;
      for (const l of linked.data ?? []) {
        const wanted = campaigns[l.external_account_id as string];
        if (!wanted) continue;
        const connection = l.connection_id ? await getCompanyConnection(ctx.accountId, l.connection_id as string) : null;
        if (!connection) return NextResponse.json({ error: "connection_unavailable", account: l.external_account_id }, { status: 409 });
        try {
          const existing = new Set((await listCampaigns(connection.token, l.external_account_id as string)).map((c) => c.id));
          const missing = wanted.filter((c) => !existing.has(c));
          if (missing.length > 0) return NextResponse.json({ error: "unknown_campaign", account: l.external_account_id, campaigns: missing }, { status: 400 });
        } catch (err) {
          if (!(err instanceof MetaAdsError)) throw err;
          return NextResponse.json({ error: "unreadable", detail: err.detail }, { status: 502 });
        }
      }

      const all = await collectAccountSnapshots(ctx, clientId, { since: range.since, until: range.until, compare, daily: true, campaigns });
      const idSet = new Set(ids);
      accountsSnapshot = all.filter((a) => idSet.has(a.id));
      const built = buildRealDoc({ layout, accounts: accountsSnapshot, range, newId: makeId });
      doc = built.doc;
      skipped = built.skipped;
      unreadable = built.unreadable;
      if (doc.blocks.length === 0) return NextResponse.json({ error: accountsSnapshot.every((a) => !a.insights) ? "unreadable" : "nothing_to_show", skipped, unreadable }, { status: accountsSnapshot.every((a) => !a.insights) ? 502 : 422 });
    }
    if (doc.blocks.length === 0) return NextResponse.json({ error: "Nothing to show" }, { status: 422 });
    doc.demo = body?.demo === true;

    const { data, error } = await ctx.supabase
      .from("reportei_reports")
      .insert({
        account_id: ctx.accountId,
        client_id: clientId,
        title: `Relatório de ${client.data.name}`.slice(0, 200),
        period_start: range.since,
        period_end: range.until,
        compare_start: compare?.since ?? null,
        compare_end: compare?.until ?? null,
        snapshot: { period: range, compare, accounts: accountsSnapshot, doc },
        networks: [...new Set(doc.blocks.map((b) => b.network).filter((n): n is string => !!n))],
        created_by: ctx.userId,
        auto: false,
        template_id: templateId,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[POST reportei/reports/generate]", error?.message);
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id as string, skipped, unreadable }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
