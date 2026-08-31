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
    google_rating: 4.8,
    icp_grade: "A",
    source_data: { website_signals: { finalUrl: "https://clinicaexemplo.com.br" } },
    imported_deal_id: null,
    imported_contact_id: null,
    ...overrides,
  };
}

/** In-memory fake covering exactly what import.ts touches: prospecting_runs,
 * accounts, prospecting_candidates, contacts, deals, deal_tags. */
function fakeDb(seed: { run?: unknown; account?: unknown; candidate?: unknown }) {
  const inserted: Record<string, unknown[]> = { contacts: [], deals: [], deal_tags: [] };
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
    }
    return builder;
  }

  return { from: from as never, inserted, candidateUpdates };
}

beforeEach(() => {
  mocks.findExistingContact.mockReset().mockResolvedValue(null);
  mocks.isUniqueViolation.mockReset().mockReturnValue(false);
  mocks.supabaseAdmin.mockReset().mockReturnValue({
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
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

  it("creates a contact and a deal, tags the deal, and only fills fields that were actually found", async () => {
    const db = fakeDb({ run: RUN_ROW, account: { default_currency: "BRL" }, candidate: candidateRow() });

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
    });
    const tagLabels = db.inserted.deal_tags.map((t) => (t as { label: string }).label);
    expect(tagLabels).toEqual(
      expect.arrayContaining(["Prospecção IA", "ICP A", "Google", "Site analisado", "Instagram encontrado"]),
    );
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
