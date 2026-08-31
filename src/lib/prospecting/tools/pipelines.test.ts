import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPipelines: vi.fn(),
  loadPipelineStages: vi.fn(),
}));

vi.mock("@/lib/pipelines/queries", () => ({
  loadPipelines: mocks.loadPipelines,
  loadPipelineStages: mocks.loadPipelineStages,
}));

import { listarFrentes, listarPipelines, listarResponsaveis, obterPrimeiraEtapa } from "./pipelines";
import { ProspectingToolError } from "./errors";

function fakeDb(pipelineRow: unknown, profilesData: unknown = []) {
  const pipelinesBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: pipelineRow, error: null }),
  };
  const profilesBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn().mockResolvedValue({ data: profilesData, error: null }),
  };
  const from = vi.fn((table: string) => (table === "pipelines" ? pipelinesBuilder : profilesBuilder));
  return { from };
}

beforeEach(() => {
  mocks.loadPipelines.mockReset();
  mocks.loadPipelineStages.mockReset();
});

describe("obterPrimeiraEtapa", () => {
  it("rejects when pipeline_id is missing", async () => {
    const db = fakeDb(null) as never;
    await expect(obterPrimeiraEtapa(db, "acct-1", {})).rejects.toThrow(ProspectingToolError);
  });

  it("rejects a pipeline id belonging to a different account, even a well-formed UUID, without ever calling loadPipelineStages", async () => {
    const db = fakeDb(null) as never; // ownership check finds no row -> not this account's pipeline
    await expect(
      obterPrimeiraEtapa(db, "acct-1", { pipeline_id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toMatchObject({ code: "pipeline_not_found" });
    expect(mocks.loadPipelineStages).not.toHaveBeenCalled();
  });

  it("rejects a pipeline that has no stages configured", async () => {
    const db = fakeDb({ id: "pipe-1" }) as never;
    mocks.loadPipelineStages.mockResolvedValue([]);
    await expect(
      obterPrimeiraEtapa(db, "acct-1", { pipeline_id: "pipe-1" }),
    ).rejects.toMatchObject({ code: "pipeline_without_stages" });
  });

  it("returns the lowest-position stage as the first stage", async () => {
    const db = fakeDb({ id: "pipe-1" }) as never;
    mocks.loadPipelineStages.mockResolvedValue([
      { id: "stage-2", pipeline_id: "pipe-1", name: "Segunda", position: 1, color: "#000", created_at: "" },
      { id: "stage-1", pipeline_id: "pipe-1", name: "Primeira", position: 0, color: "#000", created_at: "" },
    ]);
    const result = await obterPrimeiraEtapa(db, "acct-1", { pipeline_id: "pipe-1" });
    expect(result).toEqual({ stage_id: "stage-1", stage_name: "Primeira" });
  });
});

describe("listarPipelines", () => {
  it("maps loaded pipelines to a minimal {id, name} shape", async () => {
    mocks.loadPipelines.mockResolvedValue([
      { id: "p1", user_id: "u1", name: "Vendas", created_at: "" },
    ]);
    const result = await listarPipelines({} as never);
    expect(result).toEqual([{ id: "p1", name: "Vendas" }]);
  });
});

describe("listarResponsaveis", () => {
  it("falls back to email when full_name is empty", async () => {
    const db = fakeDb(null, [
      { user_id: "u1", full_name: "Ana", email: "ana@example.com" },
      { user_id: "u2", full_name: "", email: "sem-nome@example.com" },
    ]) as never;
    const result = await listarResponsaveis(db);
    expect(result).toEqual([
      { id: "u1", name: "Ana" },
      { id: "u2", name: "sem-nome@example.com" },
    ]);
  });
});

describe("listarFrentes", () => {
  it("returns the fixed two-option set", () => {
    expect(listarFrentes()).toEqual([
      { id: "frente_leadgen", name: "Lead Generation" },
      { id: "frente_avr", name: "E-commerce AVR" },
    ]);
  });
});
