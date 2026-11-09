import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reportei/meta-connection", () => ({ getCompanyConnection: vi.fn(async () => ({ id: "c1", token: "tok", fbUserName: "x", tokenExpiresAt: null })) }));

import { collectAccountSnapshots } from "./report-data";

type Row = Record<string, unknown>;

/** A tiny stand-in for the Supabase client: each table answers the queries the collector makes. */
function fakeDb(opts: { links: Row[]; settings?: Row | null; failWindowsColumn?: boolean }) {
  const selects: string[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    let columns = "";
    const result = () => {
      if (table === "ad_integrations") {
        if (opts.failWindowsColumn && columns.includes("attribution_windows")) return { data: null, error: { code: "42703", message: "column does not exist" } };
        return { data: opts.links, error: null };
      }
      return { data: opts.settings ?? null, error: null };
    };
    chain.select = (c: string) => {
      columns = c;
      selects.push(`${table}:${c}`);
      return chain;
    };
    chain.eq = () => chain;
    chain.order = () => Promise.resolve(result());
    chain.maybeSingle = () => Promise.resolve(result());
    return chain;
  };
  return { db: { from } as never, selects };
}

const link = (over: Row = {}): Row => ({ external_account_id: "act_1", external_account_name: "Conta", currency: "BRL", timezone: "America/Sao_Paulo", connection_id: "c1", campaign_ids: null, attribution_windows: null, ...over });
const insightsBody = (extra: Row = {}) => ({ data: [{ spend: "10", impressions: "100", clicks: "5", ...extra }] });

function stubFetch(body: unknown = insightsBody()) {
  const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => new URL(String(c[0])));

afterEach(() => vi.unstubAllGlobals());

describe("collectAccountSnapshots", () => {
  it("reads each account with the time zone and range really used", async () => {
    const f = stubFetch();
    const { db } = fakeDb({ links: [link()] });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31", now: new Date("2026-11-05T12:00:00Z") });
    expect(a).toMatchObject({ id: "act_1", timezone: "America/Sao_Paulo", range: { since: "2026-10-01", until: "2026-10-31" } });
    expect(JSON.parse(urls(f)[0].searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
  });

  it("never asks for days that have not started in the account's zone, and compares like with like", async () => {
    const f = stubFetch();
    const { db } = fakeDb({ links: [link({ timezone: "America/Los_Angeles" })] });
    // 02:30 UTC on the 6th is still the 5th in Los Angeles
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-11-01", until: "2026-11-06", compare: { since: "2026-10-26", until: "2026-10-31" }, now: new Date("2026-11-06T02:30:00Z") });
    expect(a.range).toEqual({ since: "2026-11-01", until: "2026-11-05" });
    expect(a.compareRange).toEqual({ since: "2026-10-27", until: "2026-10-31" });
    expect(JSON.parse(urls(f)[0].searchParams.get("time_range")!).until).toBe("2026-11-05");
  });

  it("an account whose whole range is still in its future is an error, not an empty read", async () => {
    const f = stubFetch();
    const { db } = fakeDb({ links: [link({ timezone: "America/Los_Angeles" })] });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-11-06", until: "2026-11-06", now: new Date("2026-11-06T02:30:00Z") });
    expect(a).toMatchObject({ error: "request_failed", detail: "period_after_account_today" });
    expect(f).not.toHaveBeenCalled();
  });

  it("counts leads and purchases with the events pinned for the client", async () => {
    stubFetch(insightsBody({ actions: [{ action_type: "purchase", value: "2" }, { action_type: "omni_purchase", value: "3" }], action_values: [{ action_type: "omni_purchase", value: "300" }] }));
    const { db } = fakeDb({ links: [link()], settings: { lead_event: null, purchase_event: "omni_purchase" } });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31" });
    expect(a.insights).toMatchObject({ purchaseEvent: "omni_purchase", purchases: 3, purchaseValue: 300 });
  });

  it("sends the attribution windows saved on the link and keeps what was asked", async () => {
    const f = stubFetch(insightsBody({ attribution_setting: "1d_click" }));
    const { db } = fakeDb({ links: [link({ attribution_windows: ["1d_click"] })] });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31" });
    expect(JSON.parse(urls(f)[0].searchParams.get("action_attribution_windows")!)).toEqual(["1d_click"]);
    expect(a.insights?.attribution).toEqual({ requested: ["1d_click"], mode: "explicit", effective: "1d_click" });
  });

  it("works before the attribution column exists (Meta's default attribution)", async () => {
    const f = stubFetch();
    const { db, selects } = fakeDb({ links: [link()], failWindowsColumn: true });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31" });
    expect(selects.filter((s) => s.startsWith("ad_integrations")).length).toBe(2);
    expect(urls(f)[0].searchParams.get("action_attribution_windows")).toBeNull();
    expect(a.insights?.attribution?.mode).toBe("meta_default");
  });

  it("a saved campaign filter that is not valid fails the account; it does not read the whole account", async () => {
    const f = stubFetch();
    const { db } = fakeDb({ links: [link({ campaign_ids: ["abc"] })] });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31" });
    expect(a).toMatchObject({ error: "request_failed" });
    expect(a.insights).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("a malformed answer fails the account instead of reading as no delivery", async () => {
    stubFetch({});
    const { db } = fakeDb({ links: [link()] });
    const [a] = await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31" });
    expect(a.error).toBe("request_failed");
    expect(a.insights).toBeUndefined();
  });

  it("a campaign choice for this read overrides the saved one", async () => {
    const f = stubFetch();
    const { db } = fakeDb({ links: [link({ campaign_ids: ["111"] })] });
    await collectAccountSnapshots({ supabase: db, accountId: "acc" }, "client", { since: "2026-10-01", until: "2026-10-31", campaigns: { act_1: ["222"] } });
    expect(JSON.parse(urls(f)[0].searchParams.get("filtering")!)[0].value).toEqual(["222"]);
  });
});
