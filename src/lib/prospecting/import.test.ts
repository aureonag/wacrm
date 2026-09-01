import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: vi.fn(),
  supabaseAdmin: vi.fn(),
  logProspectingAudit: vi.fn(),
}));

vi.mock("@/lib/contacts/dedupe", () => ({
  findExistingContact: mocks.findExistingContact,
  isUniqueViolation: mocks.isUniqueViolation,
}));
vi.mock("./admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock("./audit", () => ({ logProspectingAudit: mocks.logProspectingAudit }));

import { importCandidates } from "./import";

const RUN_ROW = {
  id: "run-1",
  account_id: "acct-1",
  pipeline_id: "pipe-1",
  entry_stage_id: "stage-1",
  assigned_to: "owner-1",
  frente_leadgen: true,
  frente_avr: false,
  imported_count: 0,
};

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    company_name: "Clínica Exemplo",
    contact_name: null,
    segment: "dentista",
    city: "Santo André",
    state: "SP",
    phone: "+5511999998888",
    email: "contato@clinicaexemplo.com.br",
    website: "https://clinicaexemplo.com.br",
    instagram: "clinicaexemplo",
    instagram_followers: 512,
    google_rating: 4.8,
    google_review_count: 120,
    icp_score: 82,
    icp_grade: "A",
    score_reason: "ICP A · 82 pontos.",
    source_data: {
      website_signals: { finalUrl: "https://clinicaexemplo.com.br" },
      external_notes: "Site desatualizado, Instagram pouco ativo.",
    },
    imported_deal_id: null,
    imported_contact_id: null,
    ...overrides,
  };
}

/** In-memory fake covering exactly what import.ts touches: prospecting_runs,
 * accounts, profiles, prospecting_candidates, contacts, deals, deal_tags, deal_comments. */
function fakeDb(seed: { run?: unknown; account?: unknown; candidate?: unknown; ownerProfile?: unknown }) {
  const inserted: Record<string, unknown[]> = { contacts: [], deals: [], deal_tags: [], deal_comments: [] };
  const candidateUpdates: Record<string, unknown>[] = [];
  let nextDealId = 1;
  let nextContactId = 1;

  function from(table: string) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = vi.fn(chain);
    builder.eq = vi.fn(chain);
    builder.in = vi.fn(chain);

    if (table === "prospecting_runs") {
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: seed.run ?? null, error: null });
      builder.update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
    } else if (table === "accounts") {
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: seed.account ?? null, error: null });
    } else if (table === "profiles") {
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: seed.ownerProfile ?? null, error: null });
    } else if (table === "prospecting_candidates") {
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: seed.candidate ?? null, error: null });
      builder.update = vi.fn((patch: Record<string, unknown>) => {
        candidateUpdates.push(patch);
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
      });
    } else if (table === "contacts") {
      builder.insert = vi.fn((row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const id = `contact-${nextContactId++}`;
            inserted.contacts.push({ id, ...row });
            return Promise.resolve({ data: { id, ...row }, error: null });
          },
        }),
      }));
    } else if (table === "deals") {
      builder.insert = vi.fn((row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const id = `deal-${nextDealId++}`;
            inserted.deals.push({ id, ...row });
            return Promise.resolve({ data: { id, ...row }, error: null });
          },
        }),
      }));
    } else if (table === "deal_tags") {
      builder.insert = vi.fn((rows: unknown[]) => {
        inserted.deal_tags.push(...rows);
        return Promise.resolve({ data: null, error: null });
      });
    } else if (table === "deal_comments") {
      builder.insert = vi.fn((row: Record<string, unknown>) => {
        inserted.deal_comments.push(row);
        return Promise.resolve({ data: null, error: null });
      });
    }
    return builder;
  }

  return { from: from as never, inserted, candidateUpdates };
}

beforeEach(() => {
  mocks.findExistingContact.mockReset().mockResolvedValue(null);
  mocks.isUniqueViolation.mockReset().mockReturnValue(false);
  mocks.supabaseAdmin.mockReset().mockReturnValue({
    from: vi.fn(() => {
      // Chainable enough for both the claim (`.update().eq().or().select().maybeSingle()`)
      // and the plain final status update (`.update().eq()`, awaited but not chained further).
      const builder: Record<string, unknown> = {};
      builder.update = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.select = vi.fn(() => builder);
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "run-1" }, error: null });
      builder.insert = vi.fn().mockResolvedValue({ data: null, error: null });
      return builder;
    }),
  });
  mocks.logProspectingAudit.mockReset().mockResolvedValue(undefined);
});

describe("importCandidates", () => {
  it("returns an all-failed result when the run doesn't belong to this account, without writing anything", async () => {
    const db = fakeDb({ run: null });
    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["c1"],
      accountId: "acct-1",
      userId: "user-1",
    });
    expect(result).toEqual({
      imported: 0,
      alreadyImported: 0,
      failed: 1,
      results: [{ candidateId: "c1", status: "failed", error: expect.any(String) }],
    });
    expect(db.inserted.deals).toHaveLength(0);
  });

  it("fails all candidates without writing anything when the run's lease is already claimed by a concurrent process", async () => {
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.update = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.or = vi.fn(() => builder);
        builder.select = vi.fn(() => builder);
        // Someone else (e.g. the cron sweep's stepImporting) already holds the lease.
        builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        builder.insert = vi.fn().mockResolvedValue({ data: null, error: null });
        return builder;
      }),
    });
    const db = fakeDb({ run: RUN_ROW, account: { default_currency: "BRL" }, candidate: candidateRow() });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    expect(db.inserted.contacts).toHaveLength(0);
    expect(db.inserted.deals).toHaveLength(0);
  });

  it("creates a contact and a deal, tags the deal, and only fills fields that were actually found", async () => {
    const db = fakeDb({
      run: RUN_ROW,
      account: { default_currency: "BRL" },
      candidate: candidateRow(),
      ownerProfile: { id: "profile-owner-1" },
    });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.inserted.contacts).toHaveLength(1);
    expect(db.inserted.contacts[0]).toMatchObject({ name: "Clínica Exemplo", phone: "+5511999998888" });
    expect(db.inserted.deals[0]).toMatchObject({
      title: "Clínica Exemplo",
      pipeline_id: "pipe-1",
      stage_id: "stage-1",
      region: "Santo André, SP",
      currency: "BRL",
      frente_leadgen: true,
      frente_avr: false,
      // RUN_ROW.assigned_to ("owner-1") is an auth user id; the deal must get
      // the matching profiles.id instead — see the FK translation in import.ts.
      assigned_to: "profile-owner-1",
    });
    const tagLabels = db.inserted.deal_tags.map((t) => (t as { label: string }).label);
    expect(tagLabels).toEqual(
      expect.arrayContaining(["Prospecção IA", "ICP A", "Google", "Site analisado", "Instagram encontrado"]),
    );

    expect(db.inserted.deal_comments).toHaveLength(1);
    const comment = db.inserted.deal_comments[0] as { deal_id: string; body: string };
    expect(comment.deal_id).toBe("deal-1");
    expect(comment.body).toContain("Google: 4,8 (120 avaliações)");
    expect(comment.body).toContain("Instagram: @clinicaexemplo (512 seguidores)");
    expect(comment.body).toContain("Score ICP: ICP A · 82 pontos.");
    expect(comment.body).toContain("Site desatualizado, Instagram pouco ativo.");
  });

  it("leaves the deal unassigned when the run's owner user id doesn't match any profile", async () => {
    const db = fakeDb({ run: RUN_ROW, account: { default_currency: "BRL" }, candidate: candidateRow() });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result.imported).toBe(1);
    expect(db.inserted.deals[0]).toMatchObject({ assigned_to: null });
  });

  it("skips the summary comment when nothing was actually found for the candidate", async () => {
    const db = fakeDb({
      run: RUN_ROW,
      account: { default_currency: "BRL" },
      candidate: candidateRow({
        website: null,
        instagram: null,
        instagram_followers: null,
        google_rating: null,
        google_review_count: null,
        icp_score: null,
        score_reason: null,
        source_data: {},
      }),
    });

    await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(db.inserted.deal_comments).toHaveLength(0);
  });

  it("reuses an existing contact instead of creating a duplicate when the phone already matches one", async () => {
    mocks.findExistingContact.mockResolvedValue({ id: "existing-contact", phone: "+5511999998888" });
    const db = fakeDb({ run: RUN_ROW, account: { default_currency: "BRL" }, candidate: candidateRow() });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result.results[0].contactId).toBe("existing-contact");
    expect(db.inserted.contacts).toHaveLength(0);
  });

  it("creates the deal with no linked contact (never inventing a phone) when the candidate has none", async () => {
    const db = fakeDb({
      run: RUN_ROW,
      account: { default_currency: "BRL" },
      candidate: candidateRow({ phone: null }),
    });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result.imported).toBe(1);
    expect(result.results[0].contactId).toBeNull();
    expect(db.inserted.contacts).toHaveLength(0);
    expect(db.inserted.deals[0]).toMatchObject({ contact_id: null });
  });

  it("is idempotent: a candidate already imported is reported as already_imported and nothing new is created", async () => {
    const db = fakeDb({
      run: RUN_ROW,
      account: { default_currency: "BRL" },
      candidate: candidateRow({ imported_deal_id: "deal-99", imported_contact_id: "contact-99" }),
    });

    const result = await importCandidates(db as never, {
      runId: "run-1",
      candidateIds: ["cand-1"],
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(result).toEqual({
      imported: 0,
      alreadyImported: 1,
      failed: 0,
      results: [{ candidateId: "cand-1", status: "already_imported", dealId: "deal-99", contactId: "contact-99" }],
    });
    expect(db.inserted.deals).toHaveLength(0);
    expect(db.inserted.contacts).toHaveLength(0);
  });
});
