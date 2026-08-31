import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  createExternalRun: vi.fn(),
  obterPrimeiraEtapa: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));
vi.mock("@/lib/prospecting/admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock("@/lib/prospecting/external-import", async () => {
  const actual = await vi.importActual<typeof import("@/lib/prospecting/external-import")>(
    "@/lib/prospecting/external-import",
  );
  return { ...actual, createExternalRun: mocks.createExternalRun };
});
vi.mock("@/lib/prospecting/tools/pipelines", () => ({ obterPrimeiraEtapa: mocks.obterPrimeiraEtapa }));

import { POST } from "./route";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ supabase: {}, accountId: "acct-1", userId: "user-1" });
  mocks.supabaseAdmin.mockReset().mockReturnValue({});
  mocks.createExternalRun.mockReset();
  mocks.obterPrimeiraEtapa.mockReset().mockResolvedValue({ stage_id: "s1", stage_name: "Primeira" });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/prospecting/runs/external", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/prospecting/runs/external — pasted text", () => {
  it("rejects an empty pasted_text", async () => {
    const response = await POST(
      jsonRequest({ pipeline_id: "p1", entry_stage_id: "s1", pasted_text: "   " }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createExternalRun).not.toHaveBeenCalled();
  });

  it("requires pipeline_id", async () => {
    const response = await POST(jsonRequest({ pasted_text: "Nome da empresa\nAcme\n" }));
    expect(response.status).toBe(400);
  });

  it("parses the pasted CSV and forwards rows to createExternalRun with origin external_paste", async () => {
    mocks.createExternalRun.mockResolvedValue({ runId: "run-1", insertedCount: 1, skippedCount: 0 });

    const response = await POST(
      jsonRequest({
        pipeline_id: "p1",
        entry_stage_id: "s1",
        owner_id: "owner-1",
        frente_leadgen: true,
        frente_avr: false,
        pasted_text: "Nome da empresa,Telefone\nAcme,11999990000\n",
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.run_id).toBe("run-1");
    expect(mocks.createExternalRun).toHaveBeenCalledWith(
      {},
      {},
      expect.objectContaining({
        origin: "external_paste",
        pipelineId: "p1",
        entryStageId: "s1",
        ownerId: "owner-1",
        frenteLeadgen: true,
        frenteAvr: false,
        parsedRows: [{ company_name: "Acme", phone: "11999990000" }],
      }),
    );
  });

  it("maps a pipeline_not_found tool error to 404", async () => {
    mocks.createExternalRun.mockRejectedValue(
      new ProspectingToolError("Pipeline não encontrado.", "pipeline_not_found"),
    );
    const response = await POST(
      jsonRequest({ pipeline_id: "stolen", entry_stage_id: "s1", pasted_text: "Nome da empresa\nAcme\n" }),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/prospecting/runs/external — file upload", () => {
  it("rejects a request with no file", async () => {
    const form = new FormData();
    form.set("pipeline_id", "p1");
    form.set("entry_stage_id", "s1");
    const request = new Request("http://localhost/api/prospecting/runs/external", { method: "POST", body: form });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("parses an uploaded CSV file with origin external_upload", async () => {
    mocks.createExternalRun.mockResolvedValue({ runId: "run-2", insertedCount: 2, skippedCount: 0 });

    const form = new FormData();
    form.set("pipeline_id", "p1");
    form.set("entry_stage_id", "s1");
    form.set("frente_leadgen", "true");
    form.set(
      "file",
      new File(["Nome da empresa,Cidade\nAcme,SP\nBeta,RJ\n"], "empresas.csv", { type: "text/csv" }),
    );
    const request = new Request("http://localhost/api/prospecting/runs/external", { method: "POST", body: form });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.createExternalRun).toHaveBeenCalledWith(
      {},
      {},
      expect.objectContaining({
        origin: "external_upload",
        sourceLabel: "Planilha: empresas.csv",
        parsedRows: [
          { company_name: "Acme", city: "SP" },
          { company_name: "Beta", city: "RJ" },
        ],
      }),
    );
  });
});
