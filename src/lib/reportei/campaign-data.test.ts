import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCampaignTable } from "./campaign-data";
import { CONVERSATION_ACTION } from "./meta-ads";

const reply = (data: unknown, next?: string) => ({ ok: true, status: 200, json: async () => ({ data, ...(next ? { paging: { next } } : {}) }) });
const insight = (id = "2", extra: Record<string, unknown> = {}) => ({ campaign_id: id, campaign_name: "Histórica", spend: "32.50", impressions: "100", clicks: "8", actions: [{ action_type: "lead", value: "2" }, { action_type: CONVERSATION_ACTION, value: "3" }], ...extra });
const metadata = [{ id: "1", name: "Ativa sem entrega", effective_status: "ACTIVE" }, { id: "2", name: "Pausada com entrega", effective_status: "PAUSED" }];
const read = (ids?: string[] | null, options = {}) => fetchCampaignTable("private-token", "act_1", "2026-10-01", "2026-10-31", ids, options);
function stub(campaigns: unknown = metadata, insights: unknown = [insight()]) {
  const f = vi.fn(async (raw: string | URL, init?: RequestInit) => {
    void init;
    return reply(new URL(raw).pathname.endsWith("/campaigns") ? campaigns : insights);
  });
  vi.stubGlobal("fetch", f);
  return f;
}
afterEach(() => vi.unstubAllGlobals());

describe("campaign period collection", () => {
  it("keeps active campaigns with no delivery and historical delivery from paused campaigns separate", async () => {
    const f = stub();
    const rows = await read();
    expect(rows).toEqual([
      expect.objectContaining({ id: "1", status: "ACTIVE", spend: 0, impressions: 0 }),
      expect.objectContaining({ id: "2", status: "PAUSED", spend: 32.5, impressions: 100, clicks: 8, leads: 2, conversations: 3 }),
    ]);
    expect(f).toHaveBeenCalledTimes(2); // No N+1 request per campaign.
    for (const [url, init] of f.mock.calls) {
      expect(String(url)).not.toContain("private-token");
      expect(init).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer private-token" } });
    }
  });
  it("follows both result paginations and includes campaigns removed from the current listing with unknown status", async () => {
    const f = vi.fn(async (raw: string | URL) => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/campaigns")) return url.searchParams.has("after") ? reply([metadata[1]]) : reply([metadata[0]], "https://graph.facebook.com/v21.0/act_1/campaigns?after=2");
      return url.searchParams.has("after") ? reply([insight("3")]) : reply([insight()], "https://graph.facebook.com/v21.0/act_1/insights?after=2");
    });
    vi.stubGlobal("fetch", f);
    expect(await read()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "3", status: "", name: "Histórica", spend: 32.5 })]));
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("uses the same account, campaign restriction, period, lead event and attribution as the account totals", async () => {
    const f = stub(metadata, [insight("2", { actions: [{ action_type: CONVERSATION_ACTION, value: "3" }, { action_type: "lead", value: "99" }] })]);
    const rows = await read(["2"], { events: { lead: CONVERSATION_ACTION }, attributionWindows: ["7d_click", "1d_view"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "2", leads: 3, conversations: 3 });
    const url = new URL(f.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/insights"))!);
    expect(url.pathname).toBe("/v21.0/act_1/insights");
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
    expect(JSON.parse(url.searchParams.get("filtering")!)[0].value).toEqual(["2"]);
    expect(JSON.parse(url.searchParams.get("action_attribution_windows")!)).toEqual(["7d_click", "1d_view"]);
  });
  it("a valid empty read is an empty list, not an error or demonstration rows", async () => {
    stub([], []);
    expect(await read()).toEqual([]);
  });
  it("refuses invalid account ids, campaign filters and attribution before making a request", async () => {
    const f = stub();
    await expect(read([])).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(read(["abc"])).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(read(null, { attributionWindows: ["forever"] })).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(fetchCampaignTable("t", "bad", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_filter" });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([{}, { data: null }, { data: [insight("2", { spend: "broken" })] }, { data: [insight(), insight()] }])("bad period payload is a failed read, never zero results (%j)", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async (raw: string | URL) => new URL(raw).pathname.endsWith("/campaigns") ? reply(metadata) : { ok: true, status: 200, json: async () => body }));
    await expect(read()).rejects.toMatchObject({ code: "invalid_payload" });
  });
  it("does not present malformed campaign metadata as an empty account", async () => {
    stub([{ id: "not-an-id", name: "broken" }], []);
    await expect(read()).rejects.toMatchObject({ code: "invalid_payload" });
  });
  it("does not accept out-of-filter results even if Meta returns them", async () => {
    stub(metadata, [insight("1")]);
    await expect(read(["2"])).rejects.toMatchObject({ code: "invalid_payload" });
  });
  it("refuses pagination away from Graph without forwarding the token", async () => {
    const f = vi.fn(async (raw: string | URL) => new URL(raw).pathname.endsWith("/campaigns") ? reply(metadata) : reply([insight()], "https://evil.example/steal"));
    vi.stubGlobal("fetch", f);
    await expect(read()).rejects.toMatchObject({ code: "invalid_payload" });
    expect(f.mock.calls.every(([u]) => new URL(u).hostname === "graph.facebook.com")).toBe(true);
  });
  it("does not silently truncate a table above the document row limit", async () => {
    stub(Array.from({ length: 501 }, (_, i) => ({ id: String(i + 1), name: "C", effective_status: "ACTIVE" })), []);
    await expect(read()).rejects.toMatchObject({ detail: "campaign_table_limit" });
  });
});
