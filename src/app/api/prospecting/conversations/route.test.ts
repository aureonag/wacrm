import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentAccount: vi.fn(),
  assertPipelineOwnership: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));

vi.mock("@/lib/prospecting/tools/pipelines", () => ({
  assertPipelineOwnership: mocks.assertPipelineOwnership,
}));

import { GET, POST } from "./route";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";

function request(body: unknown) {
  return new Request("http://localhost/api/prospecting/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeSupabase(overrides: { profileFound?: boolean; insertResult?: unknown } = {}) {
  const conversationsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn().mockResolvedValue({ data: [{ id: "conv-1" }], error: null }),
    insert: vi.fn(function (this: unknown) {
      return this;
    }),
    single: vi
      .fn()
      .mockResolvedValue({ data: overrides.insertResult ?? { id: "conv-new" }, error: null }),
  };
  const profilesBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: overrides.profileFound === false ? null : { user_id: "owner-1" }, error: null }),
  };
  const from = vi.fn((table: string) => (table === "prospecting_conversations" ? conversationsBuilder : profilesBuilder));
  return { from };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.getCurrentAccount.mockReset();
  mocks.assertPipelineOwnership.mockReset();
});

describe("GET /api/prospecting/conversations", () => {
  it("lists the account's conversations", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ supabase: fakeSupabase(), accountId: "acct-1" });
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.conversations).toEqual([{ id: "conv-1" }]);
  });
});

describe("POST /api/prospecting/conversations", () => {
  it("rejects a pipeline id that doesn't belong to this account", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeSupabase(), accountId: "acct-1", userId: "user-1" });
    mocks.assertPipelineOwnership.mockRejectedValue(
      new ProspectingToolError("Pipeline não encontrado ou não pertence a esta conta.", "pipeline_not_found"),
    );

    const response = await POST(request({ selected_pipeline_id: "other-account-pipeline" }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("não pertence a esta conta");
  });

  it("rejects an owner id that isn't a member of this account", async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: fakeSupabase({ profileFound: false }),
      accountId: "acct-1",
      userId: "user-1",
    });

    const response = await POST(request({ selected_owner_id: "stranger-id" }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("member of this account");
  });

  it("creates a conversation with clamped quantity when valid", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeSupabase(), accountId: "acct-1", userId: "user-1" });

    const response = await POST(request({ requested_quantity: 999 }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.conversation).toEqual({ id: "conv-new" });
  });
});
