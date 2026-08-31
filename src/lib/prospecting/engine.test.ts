import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGooglePlacesConfigured: vi.fn(),
  searchPlacesText: vi.fn(),
  getPlaceDetails: vi.fn(),
  analyzeWebsite: vi.fn(),
  findInstagramFromWebsiteLinks: vi.fn(),
  checkDuplicate: vi.fn(),
  scoreIcp: vi.fn(),
  importCandidates: vi.fn(),
}));

vi.mock("./google-places", async () => {
  const actual = await vi.importActual<typeof import("./google-places")>("./google-places");
  return {
    ...actual,
    isGooglePlacesConfigured: mocks.isGooglePlacesConfigured,
    searchPlacesText: mocks.searchPlacesText,
    getPlaceDetails: mocks.getPlaceDetails,
  };
});
vi.mock("./website-analyzer", () => ({ analyzeWebsite: mocks.analyzeWebsite }));
vi.mock("./instagram-lookup", () => ({ findInstagramFromWebsiteLinks: mocks.findInstagramFromWebsiteLinks }));
vi.mock("./dedupe", () => ({ checkDuplicate: mocks.checkDuplicate }));
vi.mock("./icp-rubric", () => ({ scoreIcp: mocks.scoreIcp }));
vi.mock("./import", () => ({ importCandidates: mocks.importCandidates }));

import { advanceRun } from "./engine";

// ---- Minimal in-memory fake of the Supabase query builder, covering
// exactly the operations engine.ts performs (select/eq/maybeSingle,
// update/eq, insert, upsert with onConflict+ignoreDuplicates, and a
// count-mode select awaited directly). Good enough to exercise real
// state-machine logic without a live database. ----
function fakeAdmin(seed: Record<string, Record<string, unknown>[]>) {
  const tables: Record<string, Record<string, unknown>[]> = { ...seed };
  let nextId = 1;

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let countMode = false;

    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      is(col: string, val: null) {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
      maybeSingle: async () => {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: unknown) => unknown) {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (countMode) return Promise.resolve(resolve({ data: null, count: rows.length, error: null }));
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
      update(patch: Record<string, unknown>) {
        return {
          eq: (col: string, val: unknown) => {
            tables[table] = tables[table].map((r) => (r[col] === val ? { ...r, ...patch } : r));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      insert(newRows: Record<string, unknown> | Record<string, unknown>[]) {
        const arr = Array.isArray(newRows) ? newRows : [newRows];
        tables[table] = [...tables[table], ...arr.map((r) => ({ id: `${table}-${nextId++}`, ...r }))];
        return Promise.resolve({ data: null, error: null });
      },
      upsert(newRows: Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const conflictCols = opts?.onConflict?.split(",") ?? [];
        for (const row of newRows) {
          const exists =
            conflictCols.length > 0 && tables[table].some((r) => conflictCols.every((c) => r[c] === row[c]));
          if (exists && opts?.ignoreDuplicates) continue;
          tables[table] = [...tables[table], { id: `${table}-${nextId++}`, ...row }];
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  return { from: from as never, tables };
}

beforeEach(() => {
  mocks.isGooglePlacesConfigured.mockReset().mockReturnValue(true);
  mocks.searchPlacesText.mockReset();
  mocks.getPlaceDetails.mockReset();
  mocks.analyzeWebsite.mockReset().mockResolvedValue(null);
  mocks.findInstagramFromWebsiteLinks.mockReset().mockReturnValue({ handle: null, profileUrl: null, source: null, followers: null, engagement: null });
  mocks.checkDuplicate.mockReset().mockResolvedValue({ status: "new", contactId: null, dealId: null, matchedOn: null });
  mocks.scoreIcp.mockReset().mockReturnValue({ score: 80, grade: "A", reason: "ICP A", rubricVersion: "v1" });
  mocks.importCandidates.mockReset().mockResolvedValue({ imported: 0, alreadyImported: 0, failed: 0, results: [] });
});

const baseRun = {
  id: "run-1",
  account_id: "acct-1",
  status: "queued",
  origin: "ai_chat",
  pipeline_id: "pipe-1",
  entry_stage_id: "stage-1",
  requested_quantity: 4,
  found_count: 0,
  validated_count: 0,
  duplicate_count: 0,
  parsed_request: { niche: "dentista", region: "Santo André" },
  progress: {},
};

describe("advanceRun — queued", () => {
  it("transitions to searching when the pipeline and stage both belong to the account", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun }],
      pipelines: [{ id: "pipe-1", account_id: "acct-1" }],
      pipeline_stages: [{ id: "stage-1", pipeline_id: "pipe-1" }],
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("searching");
  });

  it("fails the run instead of proceeding when the pipeline doesn't belong to this account", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun }],
      pipelines: [{ id: "pipe-1", account_id: "some-other-account" }],
      pipeline_stages: [{ id: "stage-1", pipeline_id: "pipe-1" }],
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("failed");
    expect(admin.tables.prospecting_runs[0].error).toBeTruthy();
  });

  it("skips straight to enriching for an external-origin run — candidates already exist, there's nothing to search", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, origin: "external_upload" }],
      pipelines: [{ id: "pipe-1", account_id: "acct-1" }],
      pipeline_stages: [{ id: "stage-1", pipeline_id: "pipe-1" }],
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("enriching");
    expect(mocks.searchPlacesText).not.toHaveBeenCalled();
  });
});

describe("advanceRun — searching", () => {
  it("fails the run explicitly when Google Places isn't configured, rather than silently no-op'ing", async () => {
    mocks.isGooglePlacesConfigured.mockReturnValue(false);
    const admin = fakeAdmin({ prospecting_runs: [{ ...baseRun, status: "searching" }] });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("failed");
    expect(mocks.searchPlacesText).not.toHaveBeenCalled();
  });

  it("moves straight to enriching when one page satisfies the target with no next page token", async () => {
    mocks.searchPlacesText.mockResolvedValue({
      places: [
        { placeId: "p1", companyName: "Clínica A", address: "Rua A", city: "Santo André", state: "SP" },
        { placeId: "p2", companyName: "Clínica B", address: "Rua B", city: "Santo André", state: "SP" },
      ],
      nextPageToken: null,
    });
    const admin = fakeAdmin({ prospecting_runs: [{ ...baseRun, status: "searching" }] });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("enriching");
    expect(admin.tables.prospecting_runs[0].found_count).toBe(2);
    expect(admin.tables.prospecting_candidates).toHaveLength(2);
  });

  it("yields (stays searching) when more pages remain, persisting the page token for the next tick to resume", async () => {
    mocks.searchPlacesText.mockResolvedValue({
      places: [{ placeId: "p1", companyName: "Clínica A", address: null, city: null, state: null }],
      nextPageToken: "page-2",
    });
    const admin = fakeAdmin({ prospecting_runs: [{ ...baseRun, status: "searching", requested_quantity: 40 }] });

    await advanceRun("run-1", admin as never);

    const run = admin.tables.prospecting_runs[0];
    expect(run.status).toBe("searching");
    expect((run.progress as Record<string, unknown>).next_page_token).toBe("page-2");

    // A second tick (simulating the next cron sweep) resumes with that token.
    mocks.searchPlacesText.mockResolvedValue({ places: [], nextPageToken: null });
    await advanceRun("run-1", admin as never);
    expect(mocks.searchPlacesText).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "page-2" }),
    );
  });

  it("gives up pagination after MAX_SEARCH_PAGES even if the target quantity was never reached", async () => {
    mocks.searchPlacesText.mockResolvedValue({
      places: [{ placeId: "px", companyName: "X", address: null, city: null, state: null }],
      nextPageToken: "more",
    });
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "searching", requested_quantity: 100, progress: { pages_fetched: 3 } }],
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("enriching");
  });
});

describe("advanceRun — enriching", () => {
  function candidateRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      run_id: "run-1",
      account_id: "acct-1",
      company_name: "Clínica",
      website: null,
      google_place_id: `place-${id}`,
      source_data: {},
      icp_score: null,
      ...overrides,
    };
  }

  it("enriches only a bounded batch per call, staying in 'enriching' when candidates remain", async () => {
    mocks.getPlaceDetails.mockResolvedValue({
      placeId: "p", companyName: "C", address: null, city: null, state: null,
      phone: "+551199999999", website: null, rating: 4.5, reviewCount: 10, googleMapsUrl: "https://maps",
    });
    const candidates = Array.from({ length: 7 }, (_, i) => candidateRow(`c${i}`));
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "enriching" }],
      prospecting_candidates: candidates,
    });

    await advanceRun("run-1", admin as never);

    const enrichedCount = admin.tables.prospecting_candidates.filter(
      (c) => (c.source_data as Record<string, unknown>)?.enriched_at,
    ).length;
    expect(enrichedCount).toBe(5); // ENRICH_BATCH_SIZE
    expect(admin.tables.prospecting_runs[0].status).toBe("enriching");
  });

  it("transitions to scoring once every candidate has been enriched", async () => {
    mocks.getPlaceDetails.mockResolvedValue({
      placeId: "p", companyName: "C", address: null, city: null, state: null,
      phone: null, website: null, rating: null, reviewCount: null, googleMapsUrl: null,
    });
    const candidates = [candidateRow("c1"), candidateRow("c2")];
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "enriching" }],
      prospecting_candidates: candidates,
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("scoring");
  });

  it("a failed Google enrichment for one candidate doesn't block the run or the other candidates' fields", async () => {
    mocks.getPlaceDetails.mockRejectedValue(new Error("boom"));
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "enriching" }],
      prospecting_candidates: [candidateRow("c1")],
    });

    await advanceRun("run-1", admin as never);

    expect(admin.tables.prospecting_runs[0].status).toBe("scoring");
    const updated = admin.tables.prospecting_candidates[0];
    expect((updated.source_data as Record<string, unknown>).enriched_at).toBeTruthy();
  });
});

describe("advanceRun — scoring", () => {
  it("scores every candidate, marks new ones selected, and moves to awaiting_review", async () => {
    mocks.checkDuplicate
      .mockResolvedValueOnce({ status: "new", contactId: null, dealId: null, matchedOn: null })
      .mockResolvedValueOnce({ status: "existing", contactId: "contact-1", dealId: null, matchedOn: "phone" });
    mocks.scoreIcp.mockReturnValue({ score: 90, grade: "A", reason: "ICP A", rubricVersion: "v1" });

    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "scoring" }],
      prospecting_candidates: [
        { id: "c1", run_id: "run-1", company_name: "A", website: null, source_data: {}, icp_score: null },
        { id: "c2", run_id: "run-1", company_name: "B", website: null, source_data: {}, icp_score: null },
      ],
    });

    await advanceRun("run-1", admin as never);

    const run = admin.tables.prospecting_runs[0];
    expect(run.status).toBe("awaiting_review");
    expect(run.duplicate_count).toBe(1);

    const [c1, c2] = admin.tables.prospecting_candidates;
    expect(c1.selected).toBe(true);
    expect(c1.icp_grade).toBe("A");
    expect(c2.selected).toBe(false);
    expect(c2.duplicate_status).toBe("existing");
  });

  it("skips a candidate that was already scored (resumed run), never re-charging a duplicate check", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "scoring" }],
      prospecting_candidates: [
        { id: "c1", run_id: "run-1", company_name: "A", website: null, source_data: {}, icp_score: 77 },
      ],
    });

    await advanceRun("run-1", admin as never);

    expect(mocks.checkDuplicate).not.toHaveBeenCalled();
    expect(admin.tables.prospecting_runs[0].status).toBe("awaiting_review");
  });
});

describe("advanceRun — importing (resuming an interrupted import)", () => {
  it("resumes only the candidates still selected with no imported_deal_id yet", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "importing", user_id: "user-1" }],
      prospecting_candidates: [
        { id: "c1", run_id: "run-1", selected: true, imported_deal_id: null },
        { id: "c2", run_id: "run-1", selected: true, imported_deal_id: "deal-already" },
        { id: "c3", run_id: "run-1", selected: false, imported_deal_id: null },
      ],
    });

    await advanceRun("run-1", admin as never);

    expect(mocks.importCandidates).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ runId: "run-1", accountId: "acct-1", userId: "user-1", candidateIds: ["c1"] }),
    );
  });

  it("does nothing when no candidate is left pending import", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "importing", user_id: "user-1" }],
      prospecting_candidates: [{ id: "c1", run_id: "run-1", selected: true, imported_deal_id: "deal-1" }],
    });

    await advanceRun("run-1", admin as never);

    expect(mocks.importCandidates).not.toHaveBeenCalled();
  });

  it("skips resuming when the run has no user_id to attribute the import to", async () => {
    const admin = fakeAdmin({
      prospecting_runs: [{ ...baseRun, status: "importing", user_id: null }],
      prospecting_candidates: [{ id: "c1", run_id: "run-1", selected: true, imported_deal_id: null }],
    });

    await advanceRun("run-1", admin as never);

    expect(mocks.importCandidates).not.toHaveBeenCalled();
  });
});

describe("advanceRun — terminal/no-op states", () => {
  it.each(["completed", "partially_completed", "failed", "cancelled", "awaiting_review"])(
    "does nothing when the run is already '%s'",
    async (status) => {
      const admin = fakeAdmin({ prospecting_runs: [{ ...baseRun, status }] });
      await advanceRun("run-1", admin as never);
      expect(admin.tables.prospecting_runs[0].status).toBe(status);
      expect(mocks.searchPlacesText).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the run doesn't exist", async () => {
    const admin = fakeAdmin({ prospecting_runs: [] });
    await expect(advanceRun("missing", admin as never)).resolves.toBeUndefined();
  });
});
