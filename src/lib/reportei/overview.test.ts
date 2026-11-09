import { describe, expect, it } from "vitest";
import { RULES, classify, dailySeries, deltaPct, demoOverview, goodness, isNewResult, leadRows, pendingOf, seriesTotal, sumByDate, totals, type ClientReadings, type Reading, type Why } from "./overview";

const r = (key: string, value: number | null, previous: number | null, upIsGood = true, extra: Partial<Reading> = {}): Reading => ({ key, label: key, value, previous, format: "number", upIsGood, ...extra });
const client = (id: string, readings: Reading[], over: Partial<ClientReadings> = {}): ClientReadings => ({ clientId: id, name: id, logoUrl: null, segment: "leads", status: "ok", currency: "BRL", readings, ...over });

// A lead-generation client with enough volume (10+ leads in both periods).
const leadsClient = (id: string, leads: [number, number], cpl: [number, number]) => client(id, [r("leads", leads[0], leads[1]), r("cpl", cpl[0], cpl[1], false), r("spend", 1000, 1000, true, { neutral: true })]);

describe("the rule", () => {
  it("is marked provisional until the limits are approved and configurable", () => {
    expect(RULES.provisional).toBe(true);
    expect(RULES.minVolume).toEqual({ leads: 10, purchases: 5 });
  });
});

describe("changes", () => {
  it("computes the change and flips it for metrics where lower is better", () => {
    expect(deltaPct(r("a", 120, 100))).toBe(20);
    expect(goodness(r("cpl", 80, 100, false))).toBe(20);
    expect(goodness(r("cpl", 120, 100, false))).toBe(-20);
  });

  it("has no change without a base: zero before, or a missing side", () => {
    expect(deltaPct(r("a", 5, 0))).toBeNull();
    expect(deltaPct(r("a", null, 5))).toBeNull();
    expect(deltaPct(r("a", 5, null))).toBeNull();
    expect(isNewResult(r("a", 5, 0))).toBe(true);
    expect(isNewResult(r("a", 0, 0))).toBe(false);
  });

  it("context metrics (investment) are never good or bad by themselves", () => {
    expect(goodness(r("spend", 200, 100, true, { neutral: true }))).toBeNull();
  });
});

describe("classify", () => {
  it("puts clients that improved in highlights and clients that slipped in attention", () => {
    const out = classify([leadsClient("up", [130, 100], [50, 50]), leadsClient("down", [70, 100], [50, 50]), leadsClient("flat", [101, 100], [50, 50])]);
    expect(out.highlights.map((m) => m.clientId)).toEqual(["up"]);
    expect(out.attention.map((m) => m.clientId)).toEqual(["down"]);
  });

  it("does not judge a client whose segment is not configured, that was not fully read, or that has too little volume", () => {
    const out = classify([
      client("unset", [r("leads", 200, 100)], { segment: null }),
      client("partial", [r("leads", 200, 100)], { status: "partial" }),
      client("failed", [r("leads", 200, 100)], { status: "failed" }),
      leadsClient("tiny", [9, 4], [50, 50]),
    ]);
    expect(out.highlights).toEqual([]);
    expect(out.attention).toEqual([]);
  });

  it("only judges the metrics of the client's segment", () => {
    // An e-commerce client with great leads but flat purchases is not highlighted for leads.
    const shop = client("shop", [r("leads", 500, 100), r("purchases", 100, 100), r("roas", 3, 3)], { segment: "ecommerce" });
    expect(classify([shop]).highlights).toEqual([]);
  });

  it("keeps the strongest move and shows the opposite one on the card", () => {
    const mixed = client("mixed", [r("leads", 150, 100), r("cpl", 130, 100, false)]);
    const out = classify([mixed]);
    expect(out.highlights.map((m) => m.clientId)).toEqual(["mixed"]);
    expect(out.highlights[0].contrary).toMatchObject({ label: "cpl" });
    expect(out.attention).toEqual([]);
  });

  it("limits each section and orders by strength", () => {
    const many = Array.from({ length: 10 }, (_, i) => leadsClient(`c${i}`, [150 + i * 10, 100], [50, 50]));
    const out = classify(many, 4);
    expect(out.highlights).toHaveLength(4);
    expect(out.highlights[0].clientId).toBe("c9");
  });

  it("counts what is pending instead of judging it", () => {
    const p = pendingOf([client("a", [], { status: "no_integration" }), client("b", [], { status: "failed" }), client("c", [], { status: "partial" }), client("d", [], { segment: null }), client("e", [])]);
    expect(p).toEqual({ noIntegration: 1, failed: 1, partial: 1, notConfigured: 1 });
  });
});

describe("totals", () => {
  it("keeps current totals without a comparison and preserves the account currency", () => {
    const t = totals([client("usd", [r("spend", 123, null), r("revenue", 246, null), r("leads", 10, null)], { currency: "USD" })]);
    expect(t.spend).toMatchObject({ value: 123, previous: null, currency: "USD" });
    expect(t.revenue).toMatchObject({ value: 246, previous: null, currency: "USD" });
    expect(t.cpl).toMatchObject({ value: 12.3, previous: null, currency: "USD" });
    expect(t.roas).toMatchObject({ value: 2, previous: null });
  });
  const money = (key: string, v: number, p: number) => r(key, v, p, true, { format: "money" });

  it("recomputes ROAS and CPL from the sums, not from an average", () => {
    const t = totals([
      client("a", [money("spend", 100, 100), money("revenue", 400, 200), r("leads", 10, 10)]),
      client("b", [money("spend", 300, 300), money("revenue", 600, 600), r("leads", 20, 30)]),
    ]);
    expect(t.spend.value).toBe(400);
    expect(t.roas.value).toBe(2.5);
    expect(t.cpl.value).toBeCloseTo(13.33, 2);
    expect(t.cpl.upIsGood).toBe(false);
    expect(t.coverage).toMatchObject({ spend: 2, revenue: 2, leads: 2, total: 2 });
  });

  it("does not add money across currencies", () => {
    const t = totals([client("a", [money("spend", 100, 100)], { currency: "BRL" }), client("b", [money("spend", 100, 100)], { currency: "USD" })]);
    expect(t.spend.value).toBeNull();
    expect(t.spend.why).toBe<Why>("mixed_currency");
  });

  it("leaves revenue and ROAS unavailable (not zero) when no client has a purchase event", () => {
    const t = totals([client("a", [money("spend", 100, 100), r("revenue", null, null, true, { why: "no_events" }), r("leads", 5, 5)])]);
    expect(t.revenue.value).toBeNull();
    expect(t.roas.value).toBeNull();
    expect(t.revenue.why).toBe("no_events");
  });

  it("ROAS only uses the clients that have a purchase value, and says how many", () => {
    const t = totals([
      client("shop", [money("spend", 100, 100), money("revenue", 300, 300)], { segment: "ecommerce" }),
      client("leads", [money("spend", 900, 900), r("revenue", null, null, true, { why: "no_events" }), r("leads", 30, 30)]),
    ]);
    expect(t.roas.value).toBe(3);
    expect(t.coverage).toMatchObject({ revenue: 1, total: 2 });
    expect(t.spend.value).toBe(1000);
  });

  it("only counts fully read clients", () => {
    const t = totals([client("a", [money("spend", 100, 100)]), client("b", [money("spend", 999, 999)], { status: "partial" })]);
    expect(t.spend.value).toBe(100);
  });

  it("has no CPL without leads to divide by", () => {
    const t = totals([client("a", [money("spend", 100, 100), r("leads", 0, 0)])]);
    expect(t.cpl.value).toBeNull();
    expect(t.cpl.why).toBe("no_base");
  });
});

describe("leadRows", () => {
  it("lists the lead-generation clients with their leads, most leads first, and keeps one that has leads but no revenue", () => {
    const rows = leadRows(
      [
        client("few", [r("leads", 10, 8), r("revenue", 100, 90)]),
        client("many", [r("leads", 90, 80), r("revenue", null, null, true, { why: "no_events" })]),
        client("shop", [r("leads", 500, 400), r("revenue", 5000, 4000)], { segment: "ecommerce" }),
        client("unset", [r("leads", 700, 400)], { segment: null }),
        client("down", [r("leads", 700, 400)], { status: "failed" }),
      ],
      5,
    );
    expect(rows.map((x) => x.clientId)).toEqual(["many", "few"]);
    expect(rows[0].revenue.value).toBeNull();
  });
});

describe("month series", () => {
  it("sums accounts by date without inventing days", () => {
    const sum = sumByDate([
      [
        { date: "2026-11-01", value: 10 },
        { date: "2026-11-03", value: 5 },
      ],
      [{ date: "2026-11-01", value: 2.5 }],
    ]);
    expect(sum).toEqual([
      { date: "2026-11-01", value: 12.5 },
      { date: "2026-11-03", value: 5 },
    ]);
    expect(seriesTotal(sum)).toBe(17.5);
  });
});

describe("preview", () => {
  it("spreads a total over every day of the range (demo only)", () => {
    const days = dailySeries(1000, { since: "2026-10-01", until: "2026-10-30" }, "s");
    expect(days).toHaveLength(30);
    expect(days.reduce((a, d) => a + d.value, 0)).toBeCloseTo(1000, 0);
  });

  it("demo readings are steady for the same client and period, and flagged as demo", () => {
    const cs = [{ id: "x", name: "X", logoUrl: null }];
    const range = { since: "2026-10-01", until: "2026-10-07" };
    expect(demoOverview.readings(cs, range)).toEqual(demoOverview.readings(cs, range));
    expect(demoOverview.demo).toBe(true);
  });
});
