import { describe, expect, it } from "vitest";
import { CONVERSATION_ACTION, parseInsightsStrict } from "./meta-ads";
import { LEAD_EVENT_OPTIONS } from "./event-config";
import { metaWidget } from "./meta-doc";
import { readingsOf } from "./overview-readings";
import { totals } from "./overview";
import type { AccountSnapshot } from "./report";

const row = { spend: "100", impressions: "1000", clicks: "50", actions: [{ action_type: "lead", value: "9" }, { action_type: CONVERSATION_ACTION, value: "20" }] };
const range = { since: "2026-11-01", until: "2026-11-09" };
const snap = (insights = parseInsightsStrict(row)): AccountSnapshot => ({ id: "act_1", name: "Example", currency: "BRL", insights, previous: parseInsightsStrict({ ...row, spend: "80" }) });

describe("messaging results", () => {
  it("keeps conversations independent by default, and counts only that event when explicitly selected as leads", () => {
    expect(LEAD_EVENT_OPTIONS).toContain(CONVERSATION_ACTION);
    expect(parseInsightsStrict(row)).toMatchObject({ leads: 9, conversations: 20, leadEvent: "lead" });
    const insights = parseInsightsStrict(row, { events: { lead: CONVERSATION_ACTION } });
    expect(insights).toMatchObject({ leads: 20, conversations: 20, costPerLead: 5, leadEvent: CONVERSATION_ACTION });
    const readings = readingsOf([snap(insights)]);
    const summary = totals([{ clientId: "client", name: "Example", logoUrl: null, segment: "leads", ...readings }]);
    expect(summary.leads.value).toBe(9); // Overview cards keep direct leads separate from conversations.
    expect(summary.conversations.value).toBe(20);
    expect(summary.cpl.value).toBe(11.11);
  });
  it("exposes real quantity, comparison and cost in the editable dashboard catalog", () => {
    expect(metaWidget("conversations", snap(), { id: "w", range })).toMatchObject({ title: "Conversas por mensagem iniciadas", value: 20, previous: 20, comparison: true });
    expect(metaWidget("cost_per_conversation", snap(), { id: "w", range })).toMatchObject({ value: 5, previous: 4, currency: "BRL", upIsGood: false });
  });
  it("has no cost without conversations and distinguishes an old/missing field from a true zero", () => {
    const zero = parseInsightsStrict({ ...row, actions: [] });
    expect(zero.conversations).toBe(0);
    expect(metaWidget("cost_per_conversation", snap(zero), { id: "w", range })?.unavailable).toBeTruthy();
    const missing = parseInsightsStrict({ spend: "100", impressions: "1000", clicks: "50" });
    expect(missing.conversations).toBeUndefined();
    expect(metaWidget("conversations", snap(missing), { id: "w", range })?.unavailable).toBeTruthy();
    expect(readingsOf([snap(missing)]).readings.find((r) => r.key === "conversations")?.value).toBeNull();
  });
});
