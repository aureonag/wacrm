import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  logProspectingAudit: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));
vi.mock("@/lib/prospecting/admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock("@/lib/prospecting/audit", () => ({ logProspectingAudit: mocks.logProspectingAudit }));

import { DELETE, GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "run-1" }) };

function fakeDb(seed: { run?: unknown; candidates?: unknown; candidate?: unknown }) {
  const runsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: seed.run ?? null, error: null }),
  };
  const candidatesBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn().mockResolvedValue({ data: seed.candidates ?? [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: seed.candidate ?? null, error: null }),
    update: vi.fn(function (this: unknown) {
      return this;
    }),
  };
  const from = vi.fn((table: string) => (table === "prospecting_runs" ? runsBuilder : candidatesBuilder));
  return { from, candidatesBuilder };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Fake service-role client covering exactly the DELETE handler's chain. */
function fakeAdmin(result: { data: unknown; error: unknown }) {
  const deleteBuilder: Record<string, unknown> = {};
  deleteBuilder.delete = vi.fn(() => deleteBuilder);
  deleteBuilder.in = vi.fn(() => deleteBuilder);
  deleteBuilder.eq = vi.fn(() => deleteBuilder);
  deleteBuilder.select = vi.fn().mockResolvedValue(result);
  deleteBuilder.insert = vi.fn().mockResolvedValue({ data: null, error: null }); // logProspectingAudit isn't mocked at this depth
  return { from: vi.fn(() => deleteBuilder), _builder: deleteBuilder };
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.supabaseAdmin.mockReset();
  mocks.logProspectingAudit.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/prospecting/runs/[id]/candidates", () => {
  it("returns 404 when the run doesn't belong to this account", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ supabase: fakeDb({ run: null }), accountId: "acct-1" });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(404);
  });

  it("lists candidates for an owned run", async () => {
    const db = fakeDb({ run: { id: "run-1" }, candidates: [{ id: "c1" }] });
    mocks.getCurrentAccount.mockResolvedValue({ supabase: db, accountId: "acct-1" });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toEqual([{ id: "c1" }]);
  });
});

describe("PATCH /api/prospecting/runs/[id]/candidates", () => {
  it("requires candidate_id and a boolean selected", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({}), accountId: "acct-1" });
    const response = await PATCH(patchRequest({ candidate_id: "c1" }), params);
    expect(response.status).toBe(400);
  });

  it("rejects a candidate that doesn't belong to this run/account", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({ candidate: null }), accountId: "acct-1" });
    const response = await PATCH(patchRequest({ candidate_id: "c1", selected: true }), params);
    expect(response.status).toBe(404);
  });

  it("updates selected when the candidate is owned", async () => {
    const db = fakeDb({ candidate: { id: "c1" } });
    db.candidatesBuilder.update = vi.fn((patch: Record<string, unknown>) => ({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      __patch: patch,
    })) as never;
    mocks.requireRole.mockResolvedValue({ supabase: db, accountId: "acct-1" });

    const response = await PATCH(patchRequest({ candidate_id: "c1", selected: false }), params);

    expect(response.status).toBe(200);
    expect(db.candidatesBuilder.update).toHaveBeenCalledWith({ selected: false });
  });
});

describe("DELETE /api/prospecting/runs/[id]/candidates", () => {
  it("requires candidate_ids", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({}), accountId: "acct-1", userId: "user-1" });
    const response = await DELETE(deleteRequest({}), params);
    expect(response.status).toBe(400);
  });

  it("returns 404 when the run doesn't belong to this account, without deleting anything", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({ run: null }), accountId: "acct-1", userId: "user-1" });
    const response = await DELETE(deleteRequest({ candidate_ids: ["c1"] }), params);
    expect(response.status).toBe(404);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("deletes candidates scoped to this run/account, imported or not", async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: fakeDb({ run: { id: "run-1" } }),
      accountId: "acct-1",
      userId: "user-1",
    });
    const admin = fakeAdmin({ data: [{ id: "c1" }, { id: "c2" }], error: null });
    mocks.supabaseAdmin.mockReturnValue(admin);

    const response = await DELETE(deleteRequest({ candidate_ids: ["c1", "c2"] }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.deleted).toBe(2);
    expect(admin._builder.in).toHaveBeenCalledWith("id", ["c1", "c2"]);
    expect(admin._builder.eq).toHaveBeenCalledWith("run_id", "run-1");
    expect(admin._builder.eq).toHaveBeenCalledWith("account_id", "acct-1");
  });

  it("surfaces a 500 when the delete itself errors", async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: fakeDb({ run: { id: "run-1" } }),
      accountId: "acct-1",
      userId: "user-1",
    });
    mocks.supabaseAdmin.mockReturnValue(fakeAdmin({ data: null, error: { message: "boom" } }));

    const response = await DELETE(deleteRequest({ candidate_ids: ["c1"] }), params);
    expect(response.status).toBe(500);
  });
});
