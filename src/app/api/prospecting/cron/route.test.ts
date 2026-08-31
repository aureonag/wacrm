import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  advanceRun: vi.fn(),
}));

vi.mock("@/lib/prospecting/admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock("@/lib/prospecting/engine", () => ({ advanceRun: mocks.advanceRun }));

import { GET } from "./route";

const originalSecret = process.env.AUTOMATION_CRON_SECRET;

function request(secret?: string) {
  const headers = new Headers();
  if (secret !== undefined) headers.set("x-cron-secret", secret);
  return new Request("http://localhost/api/prospecting/cron", { headers });
}

function fakeAdmin(dueRows: { id: string }[], claimSucceedsFor: Set<string> = new Set(dueRows.map((r) => r.id))) {
  const selectBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    in: vi.fn(function (this: unknown) {
      return this;
    }),
    or: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn().mockResolvedValue({ data: dueRows, error: null }),
  };
  const from = vi.fn(() => {
    let updateTargetId = "";
    const updateBuilder = {
      eq: vi.fn((col: string, val: string) => {
        if (col === "id") updateTargetId = val;
        return updateBuilder;
      }),
      or: vi.fn(() => updateBuilder),
      select: vi.fn(() => updateBuilder),
      // Read `updateTargetId` at call time, by which point .eq("id", ...)
      // has already run — evaluating it eagerly would capture a stale id.
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: claimSucceedsFor.has(updateTargetId) ? { id: updateTargetId } : null, error: null }),
      ),
    };
    return {
      ...selectBuilder,
      update: vi.fn(() => updateBuilder),
    };
  });
  return { from };
}

beforeEach(() => {
  mocks.supabaseAdmin.mockReset();
  mocks.advanceRun.mockReset().mockResolvedValue(undefined);
  process.env.AUTOMATION_CRON_SECRET = "test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTOMATION_CRON_SECRET;
  else process.env.AUTOMATION_CRON_SECRET = originalSecret;
});

describe("GET /api/prospecting/cron", () => {
  it("returns 503 when the shared secret isn't configured", async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    const response = await GET(request("anything"));
    expect(response.status).toBe(503);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 on a missing or wrong secret", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns processed: 0 with no DB writes when nothing is due", async () => {
    mocks.supabaseAdmin.mockReturnValue(fakeAdmin([]));
    const response = await GET(request("test-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(mocks.advanceRun).not.toHaveBeenCalled();
  });

  it("advances every successfully-claimed run and skips ones another tick already claimed", async () => {
    const admin = fakeAdmin(
      [{ id: "run-1" }, { id: "run-2" }],
      new Set(["run-1"]), // run-2's claim fails (raced by another tick)
    );
    mocks.supabaseAdmin.mockReturnValue(admin);

    const response = await GET(request("test-secret"));

    expect(await response.json()).toEqual({ processed: 1 });
    expect(mocks.advanceRun).toHaveBeenCalledTimes(1);
    expect(mocks.advanceRun).toHaveBeenCalledWith("run-1", admin);
  });
});
