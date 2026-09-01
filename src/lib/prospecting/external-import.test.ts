import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertPipelineOwnership: vi.fn(),
  startRun: vi.fn(),
  logProspectingAudit: vi.fn(),
}));

vi.mock("./tools/pipelines", () => ({ assertPipelineOwnership: mocks.assertPipelineOwnership }));
vi.mock("./engine", () => ({ startRun: mocks.startRun }));
vi.mock("./audit", () => ({ logProspectingAudit: mocks.logProspectingAudit }));

import {
  buildTemplateCsv,
  parseDelimitedText,
  normalizeExternalRow,
  createExternalRun,
  PROSPECTING_TEMPLATE_COLUMNS,
} from "./external-import";
import { ProspectingToolError } from "./tools/errors";

beforeEach(() => {
  mocks.assertPipelineOwnership.mockReset().mockResolvedValue(undefined);
  mocks.startRun.mockReset().mockResolvedValue(undefined);
  mocks.logProspectingAudit.mockReset();
});

describe("buildTemplateCsv", () => {
  it("includes every template column header, comma-separated", () => {
    const csv = buildTemplateCsv();
    for (const col of PROSPECTING_TEMPLATE_COLUMNS) {
      expect(csv).toContain(col.header);
    }
    expect(csv.split(",").length).toBe(PROSPECTING_TEMPLATE_COLUMNS.length);
  });
});

describe("parseDelimitedText", () => {
  it("parses a comma-separated block with a matching header", () => {
    const text = "Nome da empresa,Telefone,Site\nAcme Ltda,11999990000,acme.com\n";
    const { rows, warnings } = parseDelimitedText(text);
    expect(warnings).toEqual([]);
    expect(rows).toEqual([{ company_name: "Acme Ltda", phone: "11999990000", website: "acme.com" }]);
  });

  it("auto-detects tab-separated content", () => {
    const text = "Nome da empresa\tCidade\nAcme\tSanto André\n";
    const { rows } = parseDelimitedText(text);
    expect(rows).toEqual([{ company_name: "Acme", city: "Santo André" }]);
  });

  it("keeps commas inside quoted fields intact", () => {
    const text = 'Nome da empresa,Endereço\n"Acme, Filial 2","Rua A, 123"\n';
    const { rows } = parseDelimitedText(text);
    expect(rows).toEqual([{ company_name: "Acme, Filial 2", address: "Rua A, 123" }]);
  });

  it("skips blank lines", () => {
    const text = "Nome da empresa\nAcme\n\nOutra\n";
    const { rows } = parseDelimitedText(text);
    expect(rows).toHaveLength(2);
  });

  it("warns when no company-name column is recognized", () => {
    const { warnings } = parseDelimitedText("Foo,Bar\n1,2\n");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns no rows for empty input", () => {
    expect(parseDelimitedText("   ")).toEqual({ rows: [], warnings: ["Nenhum conteúdo encontrado."] });
  });
});

describe("normalizeExternalRow", () => {
  it("returns null when company_name is missing or blank", () => {
    expect(normalizeExternalRow({ phone: "123" })).toBeNull();
    expect(normalizeExternalRow({ company_name: "  " })).toBeNull();
  });

  it("never fabricates a value for a missing field — absent stays null", () => {
    const result = normalizeExternalRow({ company_name: "Acme" });
    expect(result?.phone).toBeNull();
    expect(result?.website).toBeNull();
    expect(result?.notes).toBeNull();
  });

  it("carries the notes/sinais-encontrados column through", () => {
    const result = normalizeExternalRow({ company_name: "Acme", notes: "Site fraco, sem Instagram ativo." });
    expect(result?.notes).toBe("Site fraco, sem Instagram ativo.");
  });

  it("parses a pt-BR decimal comma rating", () => {
    const result = normalizeExternalRow({ company_name: "Acme", google_rating: "4,5" });
    expect(result?.google_rating).toBe(4.5);
  });

  it("also accepts a period decimal for rating", () => {
    const result = normalizeExternalRow({ company_name: "Acme", google_rating: "4.5" });
    expect(result?.google_rating).toBe(4.5);
  });

  it("drops an out-of-range or malformed rating rather than guessing", () => {
    expect(normalizeExternalRow({ company_name: "Acme", google_rating: "9,9" })?.google_rating).toBeNull();
    expect(normalizeExternalRow({ company_name: "Acme", google_rating: "ótimo" })?.google_rating).toBeNull();
  });

  it("pulls the leading integer out of a review-count cell even with extra text", () => {
    const result = normalizeExternalRow({ company_name: "Acme", google_review_count: "290 avaliações" });
    expect(result?.google_review_count).toBe(290);
  });

  it("pulls the leading integer out of an instagram-followers cell even with extra text", () => {
    const result = normalizeExternalRow({ company_name: "Acme", instagram_followers: "2.4 mil seguidores" });
    expect(result?.instagram_followers).toBe(2);
  });

  it("leaves instagram_followers null when the cell is absent", () => {
    expect(normalizeExternalRow({ company_name: "Acme" })?.instagram_followers).toBeNull();
  });
});

function fakeDbs() {
  const runsInsertCalls: unknown[] = [];
  const candidateInsertCalls: unknown[][] = [];
  const runsUpdateCalls: unknown[] = [];
  const runsBuilder = {
    insert: vi.fn((row: unknown) => {
      runsInsertCalls.push(row);
      return runsBuilder;
    }),
    update: vi.fn((patch: unknown) => {
      runsUpdateCalls.push(patch);
      return runsBuilder;
    }),
    select: vi.fn(() => runsBuilder),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: { id: "run-1" }, error: null }),
  };
  const candidatesBuilder = {
    insert: vi.fn((rows: unknown[]) => {
      candidateInsertCalls.push(rows);
      return Promise.resolve({ data: null, error: null });
    }),
  };
  const admin = {
    from: vi.fn((table: string) => (table === "prospecting_runs" ? runsBuilder : candidatesBuilder)),
  };
  return { admin, runsInsertCalls, candidateInsertCalls, runsUpdateCalls };
}

describe("createExternalRun", () => {
  const baseArgs = {
    accountId: "acct-1",
    userId: "user-1",
    pipelineId: "pipeline-1",
    entryStageId: "stage-1",
    frenteLeadgen: true,
    frenteAvr: false,
    origin: "external_paste" as const,
    sourceLabel: "Texto colado",
  };

  it("re-verifies pipeline ownership before inserting anything", async () => {
    mocks.assertPipelineOwnership.mockRejectedValue(
      new ProspectingToolError("Pipeline não encontrado.", "pipeline_not_found"),
    );
    const { admin } = fakeDbs();
    await expect(
      createExternalRun({} as never, admin as never, { ...baseArgs, parsedRows: [{ company_name: "Acme" }] }),
    ).rejects.toMatchObject({ code: "pipeline_not_found" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects an empty row set", async () => {
    const { admin } = fakeDbs();
    await expect(
      createExternalRun({} as never, admin as never, { ...baseArgs, parsedRows: [] }),
    ).rejects.toMatchObject({ code: "no_rows" });
  });

  it("rejects when every row is missing company_name", async () => {
    const { admin } = fakeDbs();
    await expect(
      createExternalRun({} as never, admin as never, { ...baseArgs, parsedRows: [{ phone: "123" }] }),
    ).rejects.toMatchObject({ code: "no_valid_rows" });
  });

  it("rejects a row count above the sanity cap", async () => {
    const { admin } = fakeDbs();
    const parsedRows = Array.from({ length: 1001 }, (_, i) => ({ company_name: `Empresa ${i}` }));
    await expect(
      createExternalRun({} as never, admin as never, { ...baseArgs, parsedRows }),
    ).rejects.toMatchObject({ code: "too_many_rows" });
  });

  it("inserts the run then the candidates, and kicks off the engine", async () => {
    const { admin, runsInsertCalls, candidateInsertCalls } = fakeDbs();
    const result = await createExternalRun({} as never, admin as never, {
      ...baseArgs,
      parsedRows: [
        { company_name: "Acme", phone: "123" },
        { company_name: "  " }, // dropped — no company name
      ],
    });

    expect(result).toEqual({ runId: "run-1", insertedCount: 1, skippedCount: 1 });
    expect((runsInsertCalls[0] as { requested_quantity: number }).requested_quantity).toBe(1);
    expect((runsInsertCalls[0] as { origin: string }).origin).toBe("external_paste");
    expect(candidateInsertCalls[0]).toHaveLength(1);
    expect((candidateInsertCalls[0][0] as { run_id: string }).run_id).toBe("run-1");
    expect(mocks.startRun).toHaveBeenCalledWith("run-1", admin);
  });

  it("carries a parsed Google rating/review count into the candidate insert", async () => {
    const { admin, candidateInsertCalls } = fakeDbs();
    await createExternalRun({} as never, admin as never, {
      ...baseArgs,
      parsedRows: [{ company_name: "Acme", google_rating: "4,7", google_review_count: "373 avaliações" }],
    });
    const row = candidateInsertCalls[0][0] as { google_rating: number | null; google_review_count: number | null };
    expect(row.google_rating).toBe(4.7);
    expect(row.google_review_count).toBe(373);
  });

  it("carries a parsed Instagram follower count into the candidate insert", async () => {
    const { admin, candidateInsertCalls } = fakeDbs();
    await createExternalRun({} as never, admin as never, {
      ...baseArgs,
      parsedRows: [{ company_name: "Acme", instagram_followers: "512" }],
    });
    const row = candidateInsertCalls[0][0] as { instagram_followers: number | null };
    expect(row.instagram_followers).toBe(512);
  });

  it("stores the notes column in source_data.external_notes", async () => {
    const { admin, candidateInsertCalls } = fakeDbs();
    await createExternalRun({} as never, admin as never, {
      ...baseArgs,
      parsedRows: [{ company_name: "Acme", notes: "Instagram parado há 6 meses." }],
    });
    const row = candidateInsertCalls[0][0] as { source_data: { external_notes?: string } };
    expect(row.source_data.external_notes).toBe("Instagram parado há 6 meses.");
  });
});
