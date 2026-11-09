import { describe, expect, it } from "vitest";
import { MetaAdsError } from "./meta-ads";
import { integrationStatus, stateOfError } from "./meta-link";
import { nonceMatches, readCookie, signState, verifyState } from "./meta-oauth";

describe("link states", () => {
  it("tells a dead token, no access and a temporary failure apart", () => {
    expect(stateOfError(new MetaAdsError("x", "token_invalid"))).toBe("token_invalid");
    expect(stateOfError(new MetaAdsError("x", "permission"))).toBe("no_access");
    expect(stateOfError(new MetaAdsError("x", "request_failed"))).toBe("failed");
    expect(stateOfError(new MetaAdsError("x", "invalid_payload"))).toBe("failed");
    expect(stateOfError(new Error("boom"))).toBe("failed");
  });

  it("an account without delivery is still a working link; the others are errors with a reason", () => {
    expect(integrationStatus("operational")).toEqual({ status: "connected", lastError: null });
    expect(integrationStatus("no_delivery")).toEqual({ status: "connected", lastError: null });
    expect(integrationStatus("no_access")).toEqual({ status: "error", lastError: "no_access" });
    expect(integrationStatus("token_invalid")).toEqual({ status: "error", lastError: "token_invalid" });
  });
});

describe("oauth state bound to the browser", () => {
  const secret = "s3cret";

  it("carries the nonce and the connection being reconnected", () => {
    const token = signState({ u: "u1", a: "a1", r: "/operational/reportei/clientes", n: "abc123", k: "conn-1" }, secret);
    const state = verifyState(token, secret);
    expect(state).toMatchObject({ u: "u1", a: "a1", n: "abc123", k: "conn-1" });
  });

  it("only accepts the cookie that carries the same nonce", () => {
    const state = { n: "abc123" };
    expect(nonceMatches("abc123", state)).toBe(true);
    expect(nonceMatches("abc124", state)).toBe(false);
    expect(nonceMatches("abc12", state)).toBe(false);
    expect(nonceMatches(null, state)).toBe(false);
  });

  it("reads one cookie out of the header", () => {
    expect(readCookie("a=1; meta_oauth_n=xyz; b=2", "meta_oauth_n")).toBe("xyz");
    expect(readCookie("a=1", "meta_oauth_n")).toBeNull();
    expect(readCookie(null, "meta_oauth_n")).toBeNull();
  });

  it("rejects a tampered or expired state", () => {
    const token = signState({ u: "u1", a: "a1", r: "/operational/reportei/clientes" }, secret, 1000);
    expect(verifyState(token, secret, 1000 + 60_000)).not.toBeNull();
    expect(verifyState(token, secret, 1000 + 11 * 60_000)).toBeNull();
    expect(verifyState(token + "x", secret, 1000)).toBeNull();
  });
});

import { afterEach, vi } from "vitest";
import { accountDownNotice, becameBroken, checkLinksOfConnection, healthPatch } from "./meta-link";

afterEach(() => vi.unstubAllGlobals());

describe("health per account", () => {
  it("what is saved on a link after a check: status, reason, state and when it was proven", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(healthPatch({ state: "operational" }, now)).toEqual({ status: "connected", last_error: null, last_state: "operational", last_verified_at: "2026-11-06T12:00:00.000Z" });
    expect(healthPatch({ state: "no_delivery" }, now)).toMatchObject({ status: "connected", last_state: "no_delivery" });
    expect(healthPatch({ state: "no_access" }, now)).toMatchObject({ status: "error", last_error: "no_access", last_state: "no_access" });
  });

  it("only a link that was working and no longer is counts as newly broken (so the notice comes once)", () => {
    expect(becameBroken("connected", { state: "no_access" })).toBe(true);
    expect(becameBroken("error", { state: "no_access" })).toBe(false);
    expect(becameBroken("connected", { state: "operational" })).toBe(false);
  });

  it("the notice names the account and the reason", () => {
    expect(accountDownNotice("Loja X", "no_access")).toMatchObject({ type: "integration_down", title: expect.stringContaining("Loja X"), body: expect.stringContaining("não tem mais acesso") });
    expect(accountDownNotice("Loja X", "token_invalid").body).toContain("expirou");
  });

  function fakeAdmin(rows: { id: string; external_account_id: string; external_account_name: string; status: string }[]) {
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }),
        update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => (updates.push({ id, patch }), Promise.resolve({ error: null })) }),
      }),
    };
    return { db: db as never, updates };
  }
  const graph = (answers: Record<string, { status: number; body: unknown }>) =>
    vi.fn(async (url: URL | string) => {
      const id = String(url).match(/act_\d+/)?.[0] ?? "";
      const a = answers[id];
      return { ok: a.status < 400, status: a.status, json: async () => a.body };
    });

  it("checks each account of a working login on its own: one lost account does not hide behind a healthy login", async () => {
    vi.stubGlobal("fetch", graph({
      act_1: { status: 200, body: { id: "act_1", account_id: "1", name: "A", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 } },
      act_2: { status: 400, body: { error: { code: 100, message: "Unsupported get request" } } },
      act_3: { status: 500, body: { error: { code: 2, message: "Service temporarily unavailable" } } },
    }));
    const { db, updates } = fakeAdmin([
      { id: "l1", external_account_id: "act_1", external_account_name: "A", status: "connected" },
      { id: "l2", external_account_id: "act_2", external_account_name: "B", status: "connected" },
      { id: "l3", external_account_id: "act_3", external_account_name: "C", status: "connected" },
    ]);
    const out = await checkLinksOfConnection(db, "conn", "tok", new Date("2026-11-06T12:00:00Z"));
    expect(out.broken).toEqual([{ id: "l2", name: "B", state: "no_access", accountId: "act_2" }]);
    expect(updates.find((u) => u.id === "l1")?.patch).toMatchObject({ status: "connected", last_state: "operational" });
    expect(updates.find((u) => u.id === "l2")?.patch).toMatchObject({ status: "error", last_error: "no_access" });
    // a temporary Meta failure is not an access problem: that link is left as it was
    expect(updates.some((u) => u.id === "l3")).toBe(false);
  });

  it("an account that was already in error is not announced again", async () => {
    vi.stubGlobal("fetch", graph({ act_2: { status: 400, body: { error: { code: 100, message: "x" } } } }));
    const { db } = fakeAdmin([{ id: "l2", external_account_id: "act_2", external_account_name: "B", status: "error" }]);
    expect((await checkLinksOfConnection(db, "conn", "tok")).broken).toEqual([]);
  });

  it("an account that comes back is marked working again (and is not 'broken')", async () => {
    vi.stubGlobal("fetch", graph({ act_2: { status: 200, body: { id: "act_2", account_id: "2", name: "B", currency: "BRL", timezone_name: "UTC", account_status: 1 } } }));
    const { db, updates } = fakeAdmin([{ id: "l2", external_account_id: "act_2", external_account_name: "B", status: "error" }]);
    const out = await checkLinksOfConnection(db, "conn", "tok");
    expect(out.broken).toEqual([]);
    expect(updates[0].patch).toMatchObject({ status: "connected", last_error: null });
  });
});
