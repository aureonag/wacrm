import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; account_id: string; user_id: string; fb_user_id: string; token_encrypted: string; status: string };

const state: { rows: Row[]; uniquePerUser: boolean } = { rows: [], uniquePerUser: true };
let nextId = 1;

/** A stand-in for meta_connections: unique (account, fb_user) always; unique (account, user) only before migration 180. */
const admin = {
  from: () => {
    let filters: Record<string, string> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: state.rows.find((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, string>)[k] === v)) ?? null, error: null }),
      update: (patch: Partial<Row>) => ({
        eq: (_c: string, id: string) => {
          const row = state.rows.find((r) => r.id === id);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        },
      }),
      insert: (row: Omit<Row, "id">) => {
        const clash = state.rows.some((r) => r.account_id === row.account_id && ((state.uniquePerUser && r.user_id === row.user_id) || r.fb_user_id === row.fb_user_id));
        const id = `c${nextId++}`;
        if (!clash) state.rows.push({ id, ...row });
        return { select: () => ({ single: () => Promise.resolve(clash ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: { id }, error: null }) }) };
      },
    };
    filters = {};
    return chain;
  },
};

vi.mock("@/lib/contracts/admin-client", () => ({ supabaseAdmin: () => admin }));
vi.mock("@/lib/whatsapp/encryption", () => ({ encrypt: (t: string) => `enc(${t})`, decrypt: (t: string) => t.replace(/^enc\((.*)\)$/, "$1") }));

import { saveConnectionSafe } from "./meta-connection";

const input = (over: Partial<Parameters<typeof saveConnectionSafe>[0]> = {}) => ({ accountId: "acc", userId: "u1", fbUserId: "fb1", fbUserName: "Ana", token: "tok1", expiresAt: null, ...over });

beforeEach(() => {
  state.rows = [];
  state.uniquePerUser = true;
  nextId = 1;
});

describe("saveConnectionSafe: connections are never overwritten", () => {
  it("a first sign-in creates the connection", async () => {
    const r = await saveConnectionSafe(input());
    expect(r.kind).toBe("created");
    expect(state.rows).toHaveLength(1);
  });

  it("the same Meta identity signing in again refreshes its own connection: same id, no second row (links stay on it)", async () => {
    const first = await saveConnectionSafe(input());
    const again = await saveConnectionSafe(input({ token: "tok2" }));
    expect(again.kind).toBe("refreshed");
    expect(again.kind === "refreshed" && first.kind === "created" && again.id === first.id).toBe(true);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].token_encrypted).toBe("enc(tok2)");
  });

  it("a second person (other CRM user, other Meta identity) gets an independent connection and the first is untouched", async () => {
    await saveConnectionSafe(input());
    const second = await saveConnectionSafe(input({ userId: "u2", fbUserId: "fb2", fbUserName: "Beto", token: "tokB" }));
    expect(second.kind).toBe("created");
    expect(state.rows.map((r) => [r.user_id, r.fb_user_id, r.token_encrypted])).toEqual([
      ["u1", "fb1", "enc(tok1)"],
      ["u2", "fb2", "enc(tokB)"],
    ]);
  });

  it("the same Meta identity signed in by another CRM user refreshes that identity's connection instead of duplicating it", async () => {
    await saveConnectionSafe(input());
    const other = await saveConnectionSafe(input({ userId: "u2", token: "tokC" }));
    expect(other.kind).toBe("refreshed");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].user_id).toBe("u1"); // who first authorized it stays
  });

  it("before migration 180, another Meta identity of the same CRM user is refused and nothing is overwritten", async () => {
    await saveConnectionSafe(input());
    const r = await saveConnectionSafe(input({ fbUserId: "fb9", fbUserName: "Outra pessoa", token: "tokX" }));
    expect(r.kind).toBe("identity_conflict");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ fb_user_id: "fb1", token_encrypted: "enc(tok1)" });
  });

  it("after migration 180, the same CRM user can add another Meta identity next to the first", async () => {
    state.uniquePerUser = false;
    await saveConnectionSafe(input());
    const r = await saveConnectionSafe(input({ fbUserId: "fb9", token: "tokX" }));
    expect(r.kind).toBe("created");
    expect(state.rows.map((x) => x.fb_user_id)).toEqual(["fb1", "fb9"]);
  });

  it("identities of different companies never meet", async () => {
    await saveConnectionSafe(input());
    const r = await saveConnectionSafe(input({ accountId: "other", userId: "u9" }));
    expect(r.kind).toBe("created");
    expect(state.rows).toHaveLength(2);
  });
});
