// ============================================================
// Prospecting: import approved candidates into real contacts + deals.
//
// Reuses the exact find-or-create-contact flow already proven in
// `deal-create-modal.tsx` (phone dedup via `findExistingContact`, the
// `isUniqueViolation` race-fallback), so a candidate imported here
// behaves identically to a deal created by hand. Only fills fields
// that were actually found — never a placeholder like "Desconhecido".
//
// Idempotent: `prospecting_candidates.imported_deal_id` is the
// marker. A second import request for the same candidate ids is a
// no-op for anything already imported (returned as
// `already_imported`, not re-created).
//
// Writes to `contacts`/`deals`/`deal_tags`/`prospecting_candidates`
// go through the caller's own client (agent+ can write all of these
// per RLS) — only `prospecting_runs`' status transitions and the
// audit log require the service-role admin client.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { DEAL_TAG_COLORS } from "@/lib/deals/tag-colors";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { supabaseAdmin } from "./admin-client";
import { logProspectingAudit } from "./audit";

const TAG_COLOR = {
  prospecting: DEAL_TAG_COLORS[6].value, // violet
  A: DEAL_TAG_COLORS[3].value, // emerald
  B: DEAL_TAG_COLORS[2].value, // amber
  C: DEAL_TAG_COLORS[0].value, // red
  google: DEAL_TAG_COLORS[5].value, // blue
  website: DEAL_TAG_COLORS[4].value, // cyan
  instagram: DEAL_TAG_COLORS[7].value, // pink
} as const;

interface RunForImport {
  id: string;
  account_id: string;
  pipeline_id: string;
  entry_stage_id: string;
  assigned_to: string | null;
  frente_leadgen: boolean;
  frente_avr: boolean;
  imported_count: number;
}

interface CandidateForImport {
  id: string;
  company_name: string;
  contact_name: string | null;
  segment: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  instagram_followers: number | null;
  google_rating: number | null;
  google_review_count: number | null;
  icp_score: number | null;
  icp_grade: "A" | "B" | "C" | null;
  score_reason: string | null;
  source_data: Record<string, unknown> | null;
  imported_deal_id: string | null;
  imported_contact_id: string | null;
}

/**
 * Everything the research turned up, as one comment on the new deal —
 * so it survives even if the `prospecting_candidates` row is later
 * deleted from the review list (the deal keeps no other copy of this
 * once that FK goes to NULL). Only ever includes fields that were
 * actually found; never a placeholder line for missing data.
 */
function buildImportSummaryComment(candidate: CandidateForImport): string {
  const lines: string[] = ["Resumo da pesquisa de prospecção:"];

  if (candidate.google_rating !== null) {
    const reviews = candidate.google_review_count;
    lines.push(`Google: ${candidate.google_rating.toFixed(1).replace(".", ",")}${reviews !== null ? ` (${reviews} avaliações)` : ""}`);
  }
  if (candidate.instagram) {
    const followers = candidate.instagram_followers;
    lines.push(`Instagram: @${candidate.instagram}${followers !== null ? ` (${followers.toLocaleString("pt-BR")} seguidores)` : ""}`);
  }
  if (candidate.website) lines.push(`Site: ${candidate.website}`);
  if (candidate.icp_score !== null) {
    lines.push(`Score ICP: ${candidate.score_reason ?? `${candidate.icp_score} pontos`}`);
  }
  const notes = candidate.source_data?.external_notes;
  if (typeof notes === "string" && notes.trim()) {
    lines.push("", "Observações:", notes.trim());
  }

  return lines.join("\n");
}

export interface ImportOneResult {
  candidateId: string;
  status: "imported" | "already_imported" | "failed";
  dealId?: string;
  contactId?: string | null;
  error?: string;
}

export interface ImportCandidatesResult {
  imported: number;
  alreadyImported: number;
  failed: number;
  results: ImportOneResult[];
}

export interface ImportCandidatesArgs {
  runId: string;
  candidateIds: string[];
  accountId: string;
  userId: string;
  /**
   * Set by `stepImporting` (src/lib/prospecting/engine.ts), whose caller —
   * the cron sweep — already claimed this run's `claimed_until` lease before
   * invoking it. Skips re-claiming here, since a second conditional update
   * against the very lease the cron just set would always fail (it isn't
   * null or expired yet) and turn every cron-driven resume into a no-op.
   */
  alreadyClaimed?: boolean;
}

// Generous vs. the cron's own 2-minute lease (src/app/api/prospecting/cron/route.ts)
// — this path does the same per-candidate work synchronously in one request, so it
// needs enough headroom for a full batch, not just one tick's worth of progress.
const IMPORT_LEASE_MS = 5 * 60 * 1000;

function failAll(candidateIds: string[], error: string): ImportCandidatesResult {
  return {
    imported: 0,
    alreadyImported: 0,
    failed: candidateIds.length,
    results: candidateIds.map((candidateId) => ({ candidateId, status: "failed", error })),
  };
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  candidate: CandidateForImport,
): Promise<string | null> {
  // `contacts.phone` is NOT NULL — a candidate with no phone found (by
  // Google or the website scan) simply gets no linked contact, rather
  // than inventing one. `deals.contact_id` is nullable for exactly
  // this case.
  if (!candidate.phone) return null;

  const existing = await findExistingContact(db, accountId, candidate.phone);
  if (existing) return existing.id;

  const { data: newContact, error } = await db
    .from("contacts")
    .insert({
      user_id: userId,
      account_id: accountId,
      name: candidate.contact_name || candidate.company_name,
      phone: candidate.phone,
      email: candidate.email || null,
      website: candidate.website || null,
      instagram: candidate.instagram || null,
    })
    .select()
    .single();

  if (!error && newContact) return newContact.id as string;

  // A racing insert may have just created the same contact — same
  // backstop `deal-create-modal.tsx` uses.
  if (isUniqueViolation(error)) {
    const retry = await findExistingContact(db, accountId, candidate.phone);
    if (retry) return retry.id;
  }
  throw new Error("Falha ao criar o contato.");
}

async function importOne(
  db: SupabaseClient,
  admin: SupabaseClient,
  run: RunForImport,
  candidate: CandidateForImport,
  currency: string,
  userId: string,
): Promise<ImportOneResult> {
  if (candidate.imported_deal_id) {
    return {
      candidateId: candidate.id,
      status: "already_imported",
      dealId: candidate.imported_deal_id,
      contactId: candidate.imported_contact_id,
    };
  }

  try {
    const contactId = await findOrCreateContact(db, run.account_id, userId, candidate);
    const region = [candidate.city, candidate.state].filter(Boolean).join(", ") || null;

    const { data: deal, error: dealError } = await db
      .from("deals")
      .insert({
        user_id: userId,
        account_id: run.account_id,
        pipeline_id: run.pipeline_id,
        stage_id: run.entry_stage_id,
        contact_id: contactId,
        assigned_to: run.assigned_to,
        title: candidate.company_name,
        value: 0,
        currency,
        segment: candidate.segment,
        region,
        frente_leadgen: run.frente_leadgen,
        frente_avr: run.frente_avr,
        status: "open",
        prospecting_candidate_id: candidate.id,
      })
      .select()
      .single();
    if (dealError || !deal) throw new Error("Falha ao criar o negócio.");

    const tags: { label: string; color: string }[] = [{ label: "Prospecção IA", color: TAG_COLOR.prospecting }];
    if (candidate.icp_grade) tags.push({ label: `ICP ${candidate.icp_grade}`, color: TAG_COLOR[candidate.icp_grade] });
    if (candidate.google_rating !== null) tags.push({ label: "Google", color: TAG_COLOR.google });
    if (candidate.source_data?.website_signals) tags.push({ label: "Site analisado", color: TAG_COLOR.website });
    if (candidate.instagram) tags.push({ label: "Instagram encontrado", color: TAG_COLOR.instagram });

    await db
      .from("deal_tags")
      .insert(tags.map((t) => ({ deal_id: deal.id, account_id: run.account_id, label: t.label, color: t.color })));

    const summary = buildImportSummaryComment(candidate);
    if (summary.split("\n").length > 1) {
      // Best-effort — a comment failing to save shouldn't fail the import
      // itself; the candidate row (until deleted) still has the raw data.
      await db.from("deal_comments").insert({ deal_id: deal.id, account_id: run.account_id, user_id: userId, body: summary });
    }

    // Idempotency marker — a single UPDATE, checked at the top of this
    // function before any of the above runs again for this candidate.
    await db
      .from("prospecting_candidates")
      .update({ imported_deal_id: deal.id, imported_contact_id: contactId })
      .eq("id", candidate.id);

    void logProspectingAudit(admin, {
      accountId: run.account_id,
      userId,
      runId: run.id,
      action: "import_candidate",
      status: "success",
      metadata: { candidateId: candidate.id, dealId: deal.id, contactId },
    });

    return { candidateId: candidate.id, status: "imported", dealId: deal.id as string, contactId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido ao importar.";
    void logProspectingAudit(admin, {
      accountId: run.account_id,
      userId,
      runId: run.id,
      action: "import_candidate",
      status: "failed",
      error: message,
      metadata: { candidateId: candidate.id },
    });
    return { candidateId: candidate.id, status: "failed", error: message };
  }
}

export async function importCandidates(
  db: SupabaseClient,
  args: ImportCandidatesArgs,
): Promise<ImportCandidatesResult> {
  const { runId, candidateIds, accountId, userId, alreadyClaimed } = args;
  if (candidateIds.length === 0) return { imported: 0, alreadyImported: 0, failed: 0, results: [] };

  const admin = supabaseAdmin();

  const { data: run } = await db
    .from("prospecting_runs")
    .select("id, account_id, pipeline_id, entry_stage_id, assigned_to, frente_leadgen, frente_avr, imported_count")
    .eq("id", runId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!run) return failAll(candidateIds, "Execução não encontrada ou não pertence a esta conta.");

  if (alreadyClaimed) {
    await admin.from("prospecting_runs").update({ status: "importing" }).eq("id", runId);
  } else {
    // Claim the same `claimed_until` lease the cron sweep uses (see
    // src/app/api/prospecting/cron/route.ts) before doing any writes. Without
    // this, a cron tick landing while this request is mid-loop sees
    // status="importing" with an expired/absent lease, claims the run itself,
    // and runs `stepImporting` concurrently — two processes racing to
    // find-or-create the same contacts for the same candidates, which
    // surfaces as intermittent "Falha ao criar o contato." failures.
    const nowIso = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + IMPORT_LEASE_MS).toISOString();
    const { data: claimed } = await admin
      .from("prospecting_runs")
      .update({ status: "importing", claimed_until: leaseUntil })
      .eq("id", runId)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      return failAll(candidateIds, "Esta execução já está sendo importada por outro processo. Tente novamente em instantes.");
    }
  }

  const { data: accountRow } = await db.from("accounts").select("default_currency").eq("id", accountId).maybeSingle();
  const currency = (accountRow?.default_currency as string | undefined) || DEFAULT_CURRENCY;

  const results: ImportOneResult[] = [];
  let imported = 0;
  let alreadyImported = 0;
  let failed = 0;

  for (const candidateId of candidateIds) {
    const { data: candidate } = await db
      .from("prospecting_candidates")
      .select("*")
      .eq("id", candidateId)
      .eq("run_id", runId)
      .eq("account_id", accountId)
      .maybeSingle();

    if (!candidate) {
      failed++;
      results.push({ candidateId, status: "failed", error: "Candidato não encontrado nesta execução." });
      continue;
    }

    const result = await importOne(db, admin, run as RunForImport, candidate as CandidateForImport, currency, userId);
    results.push(result);
    if (result.status === "imported") imported++;
    else if (result.status === "already_imported") alreadyImported++;
    else failed++;
  }

  await admin
    .from("prospecting_runs")
    .update({
      imported_count: (run.imported_count ?? 0) + imported,
      status: failed > 0 ? "partially_completed" : "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return { imported, alreadyImported, failed, results };
}
