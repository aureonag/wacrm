import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  importCandidates: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));
vi.mock("@/lib/prospecting/import", () => ({ importCandidates: mocks.importCandidates }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "run-1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/prospecting/runs/run-1/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.importCandidates.mockReset();
});

describe("POST /api/prospecting/runs/[id]/import", () => {
  it("rejects an empty candidate_ids list", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {}, accountId: "acct-1", userId: "user-1" });
    const response = await POST(request({ candidate_ids: [] }), params);
    expect(response.status).toBe(400);
    expect(mocks.importCandidates).not.toHaveBeenCalled();
  });

  it("threads accountId/userId/runId through to importCandidates and returns its result", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: { marker: "db" }, accountId: "acct-1", userId: "user-1" });
    mocks.importCandidates.mockResolvedValue({ imported: 1, alreadyImported: 0, failed: 0, results: [] });

    const response = await POST(request({ candidate_ids: ["c1"] }), params);

    expect(mocks.importCandidates).toHaveBeenCalledWith(
      { marker: "db" },
      { runId: "run-1", candidateIds: ["c1"], accountId: "acct-1", userId: "user-1" },
    );
    expect(await response.json()).toEqual({ imported: 1, alreadyImported: 0, failed: 0, results: [] });
  });
});
