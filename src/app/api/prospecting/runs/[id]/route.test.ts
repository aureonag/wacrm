import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));
vi.mock("@/lib/prospecting/admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "run-1" }) };

function fakeDb(runRow: unknown) {
  const builder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: runRow, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/prospecting/runs/run-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.supabaseAdmin.mockReset();
});

describe("GET /api/prospecting/runs/[id]", () => {
  it("returns 404 for a run that doesn't belong to this account", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ supabase: fakeDb(null), accountId: "acct-1" });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(404);
  });

  it("returns the run when found", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ supabase: fakeDb({ id: "run-1", status: "searching" }), accountId: "acct-1" });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).run).toEqual({ id: "run-1", status: "searching" });
  });
});

describe("PATCH /api/prospecting/runs/[id]", () => {
  it("rejects an action other than 'cancel'", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({ id: "run-1", status: "searching" }), accountId: "acct-1" });
    const response = await PATCH(patchRequest({ action: "resume" }), params);
    expect(response.status).toBe(400);
  });

  it("refuses to cancel a run that already ended", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({ id: "run-1", status: "completed" }), accountId: "acct-1" });
    const response = await PATCH(patchRequest({ action: "cancel" }), params);
    expect(response.status).toBe(400);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("cancels a non-terminal run via the admin client", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeDb({ id: "run-1", status: "searching" }), accountId: "acct-1" });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
    mocks.supabaseAdmin.mockReturnValue({ from: vi.fn(() => ({ update })) });

    const response = await PATCH(patchRequest({ action: "cancel" }), params);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
});
