import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  runProspectingTurn: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 401 })),
}));

vi.mock("@/lib/ai/config", () => ({ loadAiConfig: mocks.loadAiConfig }));
vi.mock("@/lib/prospecting/openai-agent", () => ({ runProspectingTurn: mocks.runProspectingTurn }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/prospecting/conversations/conv-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "conv-1" }) };

function fakeSupabase(conversationFound = true) {
  const inserts: unknown[] = [];
  const conversationsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: conversationFound ? { id: "conv-1" } : null, error: null }),
  };
  const messagesBuilder = {
    insert: vi.fn((row: unknown) => {
      inserts.push(row);
      return Promise.resolve({ error: null });
    }),
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    in: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const from = vi.fn((table: string) => (table === "prospecting_conversations" ? conversationsBuilder : messagesBuilder));
  return { from, inserts };
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.loadAiConfig.mockReset();
  mocks.runProspectingTurn.mockReset();
});

describe("POST /api/prospecting/conversations/[id]/messages", () => {
  it("returns 404 without touching the AI config when the conversation doesn't belong to this account", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeSupabase(false), accountId: "acct-1" });

    const response = await POST(request({ content: "oi" }), params);

    expect(response.status).toBe(404);
    expect(mocks.loadAiConfig).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    mocks.requireRole.mockResolvedValue({ supabase: fakeSupabase(), accountId: "acct-1" });
    const response = await POST(request({ content: "   " }), params);
    expect(response.status).toBe(400);
  });

  it("returns 409 with a setup CTA and opens no stream when the account has no AI config", async () => {
    const supabase = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: "acct-1" });
    mocks.loadAiConfig.mockResolvedValue(null);

    const response = await POST(request({ content: "buscar clínicas" }), params);

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.setup_url).toBe("/agents");
    // No user message should have been persisted for a turn that never ran.
    expect(supabase.inserts).toHaveLength(0);
  });

  it("streams tokens over SSE and persists both the user and assistant messages", async () => {
    const supabase = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: "acct-1" });
    mocks.loadAiConfig.mockResolvedValue({ provider: "openai", model: "gpt-5.4-mini", apiKey: "sk-test" });
    mocks.runProspectingTurn.mockImplementation(async ({ handlers }) => {
      handlers.onTextDelta("Olá");
      handlers.onDone("Olá, tudo bem?");
    });

    const response = await POST(request({ content: "oi" }), params);

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await readSse(response);
    expect(body).toContain("event: token");
    expect(body).toContain("event: done");
    expect(body).toContain("Olá, tudo bem?");

    expect(supabase.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "oi" }),
        expect.objectContaining({ role: "assistant", content: "Olá, tudo bem?" }),
      ]),
    );
  });
});
