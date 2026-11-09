import { describe, expect, it } from "vitest";
import { CONVERSATION_ACTION, parseInsightsStrict } from "./meta-ads";
import { readingsOf } from "./overview-readings";
import { leadRows, totals, type ClientReadings } from "./overview";
import type { AccountSnapshot } from "./report";

function client(leadCount: number, conversations: number, useConversations = false): ClientReadings {
  const insights = parseInsightsStrict({ spend: "100", clicks: "50", impressions: "1000", actions: [{ action_type: "lead", value: String(leadCount) }, { action_type: CONVERSATION_ACTION, value: String(conversations) }] }, { events: { lead: useConversations ? CONVERSATION_ACTION : null } });
  const snapshot: AccountSnapshot = { id: "act_1", name: "Example", currency: "BRL", insights, previous: insights };
  return { clientId: "client", name: "Example", logoUrl: null, segment: "leads", ...readingsOf([snapshot]) };
}

describe("separate lead and conversation columns", () => {
  it("shows a messaging client with zero leads, no CPL and real conversations/cost", () => {
    const [row] = leadRows([client(0, 20)]);
    expect(row.leads.value).toBe(0);
    expect(row.cpl?.value).toBeNull();
    expect(row.conversations?.value).toBe(20);
    expect(row.costPerConversation?.value).toBe(5);
  });
  it("keeps the columns separate even when conversations count as the configured lead result", () => {
    const c = client(9, 20, true);
    expect(c.readings.find((r) => r.key === "leads")?.value).toBe(20);
    const [row] = leadRows([c]);
    expect(row.leads.value).toBe(9);
    expect(row.cpl?.value).toBe(11.11);
    expect(row.conversations?.value).toBe(20);
    expect(row.costPerConversation?.value).toBe(5);
  });
  it("does not create a free conversation cost when no conversations were recorded", () => {
    const [row] = leadRows([client(10, 0)]);
    expect(row.cpl?.value).toBe(10);
    expect(row.conversations?.value).toBe(0);
    expect(row.costPerConversation?.value).toBeNull();
  });
  it("retains a client whose lead data is missing but conversations were read", () => {
    const c = client(0, 20);
    c.readings = c.readings.map((r) => r.key === "direct_leads" ? { ...r, value: null } : r);
    expect(leadRows([c])).toHaveLength(1);
    expect(leadRows([c])[0].leads.value).toBeNull();
  });
  it("computes the overall conversation cost from matching spend and counts, not an average", () => {
    const a = client(10, 10);
    const b = client(20, 90);
    b.clientId = "b";
    b.readings = b.readings.map((r) => r.key === "spend" ? { ...r, value: 300 } : r);
    const summary = totals([a, b]);
    expect(summary.costPerConversation.value).toBe(4); // (100 + 300) / (10 + 90), not mean(10, 3.33).
    expect(summary.costPerConversation.currency).toBe("BRL");
    expect(summary.coverage.conversationCost).toBe(2);
    b.readings = b.readings.map((r) => r.key === "conversations" ? { ...r, previous: null } : r);
    expect(totals([a, b]).costPerConversation.previous).toBeNull();
    b.currency = "USD";
    expect(totals([a, b]).costPerConversation).toMatchObject({ value: null, why: "mixed_currency" });
  });
  it("leaves overall conversation cost without a base instead of manufacturing zero", () => {
    expect(totals([client(10, 0)]).costPerConversation).toMatchObject({ value: null, why: "no_base" });
  });
});
