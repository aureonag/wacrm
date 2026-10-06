import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashOtp } from "@/lib/contracts/otp";
import { consumeAccessCode, newInviteToken, newResetCode } from "./access-codes";
import { baseUrl, normalizeEmail } from "./portal-access";

/** In-memory fake of the only table / query chains consumeAccessCode touches. */
function fakeAdmin(initial: { purpose: "reset" | "invite"; code: string; expiresAt: Date; attempts?: number } | null) {
  let row = initial
    ? { purpose: initial.purpose, code_hash: hashOtp(initial.code), expires_at: initial.expiresAt.toISOString(), attempts: initial.attempts ?? 0 }
    : null;

  class Query {
    private filters: Record<string, unknown> = {};
    constructor(
      private mode: "select" | "update" | "delete",
      private patch?: { attempts: number },
    ) {}
    eq(col: string, v: unknown) {
      this.filters[col] = v;
      return this;
    }
    select() {
      return this;
    }
    async maybeSingle() {
      if (!row) return { data: null, error: null };
      if ("attempts" in this.filters && this.filters.attempts !== row.attempts) return { data: null, error: null };
      if ("code_hash" in this.filters && this.filters.code_hash !== row.code_hash) return { data: null, error: null };
      const snapshot = { ...row, email: "x" };
      if (this.mode === "update" && this.patch) row = { ...row, ...this.patch };
      if (this.mode === "delete") row = null;
      return { data: snapshot, error: null };
    }
    // `await admin.from(...).delete().eq(...)` (no maybeSingle) also removes the row.
    then(resolve: (v: { error: null }) => void) {
      if (this.mode === "delete") row = null;
      resolve({ error: null });
    }
  }

  const admin = {
    from: () => ({
      select: () => new Query("select"),
      update: (patch: { attempts: number }) => new Query("update", patch),
      delete: () => new Query("delete"),
      upsert: async () => ({ error: null }),
    }),
  };
  return { admin: admin as unknown as SupabaseClient, current: () => row };
}

describe("new codes", () => {
  it("a reset code is 6 digits and lasts about 10 minutes", () => {
    const c = newResetCode();
    expect(c.code).toMatch(/^\d{6}$/);
    expect(c.hash).toBe(hashOtp(c.code));
    expect(c.purpose).toBe("reset");
    const minutes = (c.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it("an invite token is long, random and lasts 3 days", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.code).toMatch(/^[0-9a-f]{48}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.purpose).toBe("invite");
    const days = (a.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.99);
    expect(days).toBeLessThanOrEqual(3);
  });
});

describe("consumeAccessCode", () => {
  const future = () => new Date(Date.now() + 60_000);

  it("accepts the right code once and reports its purpose", async () => {
    const { admin, current } = fakeAdmin({ purpose: "invite", code: "abc123", expiresAt: future() });
    const first = await consumeAccessCode(admin, "a@b.co", "abc123");
    expect(first.ok && first.purpose).toBe("invite");
    expect(current()).toBeNull();
    const second = await consumeAccessCode(admin, "a@b.co", "abc123");
    expect(second).toEqual({ ok: false, reason: "missing" });
  });

  it("counts a wrong guess and says how many are left", async () => {
    const { admin } = fakeAdmin({ purpose: "reset", code: "123456", expiresAt: future() });
    expect(await consumeAccessCode(admin, "a@b.co", "000000")).toEqual({ ok: false, reason: "wrong", remaining: 4 });
  });

  it("locks after 5 wrong attempts even if the next guess is right", async () => {
    const { admin } = fakeAdmin({ purpose: "reset", code: "123456", expiresAt: future(), attempts: 5 });
    expect(await consumeAccessCode(admin, "a@b.co", "123456")).toEqual({ ok: false, reason: "locked" });
  });

  it("rejects an expired code", async () => {
    const { admin } = fakeAdmin({ purpose: "reset", code: "123456", expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeAccessCode(admin, "a@b.co", "123456")).toEqual({ ok: false, reason: "expired" });
  });

  it("reports a missing code", async () => {
    const { admin } = fakeAdmin(null);
    expect(await consumeAccessCode(admin, "a@b.co", "123456")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("portal-access helpers", () => {
  it("normalizes and validates e-mails", () => {
    expect(normalizeEmail("  Ana@Loja.COM ")).toBe("ana@loja.com");
    expect(normalizeEmail("not-an-email")).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });

  it("builds the link base from the forwarded host", () => {
    const req = new Request("http://internal/x", { headers: { "x-forwarded-host": "aureonag.com", "x-forwarded-proto": "https" } });
    const saved = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(baseUrl(req)).toBe("https://aureonag.com");
    process.env.NEXT_PUBLIC_SITE_URL = "https://site.example/";
    expect(baseUrl(req)).toBe("https://site.example");
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = saved;
  });
});
