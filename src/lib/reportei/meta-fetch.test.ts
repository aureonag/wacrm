import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaAdsError, fetchAccountInsights, fetchDayRows, listCampaigns } from "./meta-ads";

const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

afterEach(() => vi.unstubAllGlobals());

describe("fetchAccountInsights: what counts as 'no delivery'", () => {
  it("only a valid answer with an empty list is 'no delivery' (real zeros)", async () => {
    vi.stubGlobal("fetch", ok({ data: [] }));
    expect(await fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).toMatchObject({ delivered: false, spend: 0 });
  });

  it("an answer without a data list is a bad payload, not 'no delivery'", async () => {
    for (const body of [{}, { data: null }, { data: {} }, { paging: {} }, "garbage"]) {
      vi.stubGlobal("fetch", ok(body));
      await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_payload" });
    }
  });

  it("a non-JSON answer with status 200 is a bad payload too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => Promise.reject(new Error("not json")) }));
    await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toBeInstanceOf(MetaAdsError);
  });

  it("several rows for one period, or a row with broken numbers, are bad payloads", async () => {
    vi.stubGlobal("fetch", ok({ data: [{ spend: "1", impressions: "1", clicks: "1" }, { spend: "2", impressions: "2", clicks: "2" }] }));
    await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_payload" });
    vi.stubGlobal("fetch", ok({ data: [{ spend: "x", impressions: "1", clicks: "1" }] }));
    await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("a Meta error is an error of its own kind, never an empty result", async () => {
    vi.stubGlobal("fetch", ok({ error: { code: 190, message: "expired" } }, 400));
    await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("asks for the attribution setting and, when pinned, the windows, and keeps what was asked", async () => {
    const f = ok({ data: [{ spend: "10", impressions: "100", clicks: "5", attribution_setting: "7d_click" }] });
    vi.stubGlobal("fetch", f);
    const i = await fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31", null, { attributionWindows: ["7d_click", "1d_view"] });
    const url = new URL(calls(f)[0]);
    expect(url.searchParams.get("fields")).toContain("attribution_setting");
    expect(JSON.parse(url.searchParams.get("action_attribution_windows")!)).toEqual(["7d_click", "1d_view"]);
    expect(i.attribution).toEqual({ requested: ["7d_click", "1d_view"], mode: "explicit", effective: "7d_click" });
  });

  it("refuses an unknown attribution window before calling Meta", async () => {
    const f = ok({ data: [] });
    vi.stubGlobal("fetch", f);
    await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31", null, { attributionWindows: ["forever"] })).rejects.toMatchObject({ code: "invalid_filter" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("campaign filters are never widened", () => {
  it("a valid filter is sent to Meta", async () => {
    const f = ok({ data: [] });
    vi.stubGlobal("fetch", f);
    await fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31", ["111", "222"]);
    expect(JSON.parse(new URL(calls(f)[0]).searchParams.get("filtering")!)[0].value).toEqual(["111", "222"]);
  });

  it("an invalid or empty filter stops the read before any request, so it cannot read the whole account", async () => {
    const f = ok({ data: [] });
    vi.stubGlobal("fetch", f);
    for (const bad of [["abc"], [], ["1", "x"]]) {
      await expect(fetchAccountInsights("t", "act_1", "2026-10-01", "2026-10-31", bad)).rejects.toMatchObject({ code: "invalid_filter" });
      await expect(fetchDayRows("t", "act_1", "2026-10-01", "2026-10-31", bad)).rejects.toMatchObject({ code: "invalid_filter" });
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe("fetchDayRows and listCampaigns need a real list", () => {
  it("an empty list of days is valid; a missing one is not", async () => {
    vi.stubGlobal("fetch", ok({ data: [] }));
    expect(await fetchDayRows("t", "act_1", "2026-10-01", "2026-10-31")).toEqual([]);
    vi.stubGlobal("fetch", ok({}));
    await expect(fetchDayRows("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("campaigns: a missing list is a bad payload, not 'the account has no campaigns'", async () => {
    vi.stubGlobal("fetch", ok({ data: [] }));
    expect(await listCampaigns("t", "act_1")).toEqual([]);
    vi.stubGlobal("fetch", ok({ paging: {} }));
    await expect(listCampaigns("t", "act_1")).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("follows pages only on Graph", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ date_start: "2026-10-01", spend: "1" }], paging: { next: "https://evil.example.com/v21.0/x" } }) });
    vi.stubGlobal("fetch", f);
    await expect(fetchDayRows("t", "act_1", "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "invalid_payload" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
