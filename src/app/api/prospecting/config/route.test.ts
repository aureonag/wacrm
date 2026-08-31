import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));

import { GET } from "./route";

function fakeSupabase(row: unknown) {
  const builder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
});

afterEach(() => {
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalGoogleKey;
});

describe("GET /api/prospecting/config", () => {
  it("reports ai_configured: true only when active with a stored key", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: fakeSupabase({ is_active: true, api_key: "encrypted" }),
      accountId: "acct-1",
    });
    process.env.GOOGLE_PLACES_API_KEY = "test-key";

    const response = await GET();
    const json = await response.json();

    expect(json).toEqual({ ai_configured: true, google_places_configured: true });
  });

  it("reports ai_configured: false when the account has no ai_configs row", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: fakeSupabase(null),
      accountId: "acct-1",
    });
    delete process.env.GOOGLE_PLACES_API_KEY;

    const response = await GET();
    const json = await response.json();

    expect(json).toEqual({ ai_configured: false, google_places_configured: false });
  });

  it("reports ai_configured: false when the config exists but is inactive", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: fakeSupabase({ is_active: false, api_key: "encrypted" }),
      accountId: "acct-1",
    });

    const response = await GET();
    const json = await response.json();

    expect(json.ai_configured).toBe(false);
  });
});
