import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertPipelineOwnership: vi.fn(),
  obterPrimeiraEtapa: vi.fn(),
  startRun: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock("./pipelines", () => ({
  assertPipelineOwnership: mocks.assertPipelineOwnership,
  obterPrimeiraEtapa: mocks.obterPrimeiraEtapa,
}));
vi.mock("../engine", () => ({ startRun: mocks.startRun }));
vi.mock("../admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { pesquisarEmpresas } from "./search";
import { ProspectingToolError } from "./errors";

function fakeAdminDb(runRow: unknown, refreshedRow: unknown) {
  const insertCalls: unknown[] = [];
  const runsBuilder = {
    insert: vi.fn((row: unknown) => {
      insertCalls.push(row);
      return runsBuilder;
    }),
    select: vi.fn(() => runsBuilder),
    eq: vi.fn(() => runsBuilder),
    single: vi.fn().mockResolvedValue({ data: runRow, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: refreshedRow, error: null }),
  };
  return { from: vi.fn(() => runsBuilder), insertCalls };
}

beforeEach(() => {
  mocks.assertPipelineOwnership.mockReset();
  mocks.obterPrimeiraEtapa.mockReset().mockResolvedValue({ stage_id: "stage-1", stage_name: "Primeira" });
  mocks.startRun.mockReset().mockResolvedValue(undefined);
  mocks.supabaseAdmin.mockReset();
});

describe("pesquisarEmpresas", () => {
  it("rejects when required fields are missing, before touching the pipeline ownership check", async () => {
    await expect(
      pesquisarEmpresas({} as never, "acct-1", "user-1", { pipeline_id: "p1" }),
    ).rejects.toBeInstanceOf(ProspectingToolError);
    expect(mocks.assertPipelineOwnership).not.toHaveBeenCalled();
  });

  it("re-verifies pipeline ownership even though the model already saw it via listar_pipelines", async () => {
    mocks.assertPipelineOwnership.mockRejectedValue(new ProspectingToolError("Pipeline não encontrado.", "pipeline_not_found"));
    await expect(
      pesquisarEmpresas({} as never, "acct-1", "user-1", { pipeline_id: "stolen-id", niche: "x", region: "y", quantity: 10 }),
    ).rejects.toMatchObject({ code: "pipeline_not_found" });
  });

  it("clamps an out-of-range quantity before creating the run", async () => {
    const admin = fakeAdminDb({ id: "run-1", status: "queued" }, { status: "searching", found_count: 2, error: null });
    mocks.supabaseAdmin.mockReturnValue(admin);

    await pesquisarEmpresas({} as never, "acct-1", "user-1", {
      pipeline_id: "p1",
      niche: "dentista",
      region: "SP",
      quantity: 9999,
    });

    expect((admin.insertCalls[0] as { requested_quantity: number }).requested_quantity).toBeLessThanOrEqual(50);
  });

  it("kicks off the first engine step synchronously and returns the freshest status", async () => {
    const admin = fakeAdminDb({ id: "run-1", status: "queued" }, { status: "searching", found_count: 5, error: null });
    mocks.supabaseAdmin.mockReturnValue(admin);

    const result = await pesquisarEmpresas({} as never, "acct-1", "user-1", {
      pipeline_id: "p1",
      niche: "dentista",
      region: "Santo André",
      quantity: 10,
    });

    expect(mocks.startRun).toHaveBeenCalledWith("run-1", admin);
    expect(result).toEqual({ run_id: "run-1", status: "searching", found_count: 5, error: null });
  });
});
