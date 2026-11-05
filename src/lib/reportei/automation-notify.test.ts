import { describe, expect, it, vi } from "vitest";
import { failedNotification, notifyAutomation, readyNotification } from "./automation-notify";

describe("automation notifications", () => {
  it("builds the ready notice with the client and the period", () => {
    const n = readyNotification("weekly", "Aureon", { since: "2026-10-26", until: "2026-11-01" });
    expect(n.type).toBe("report_ready");
    expect(n.title).toBe("Relatório semanal de Aureon pronto");
    expect(n.body).toContain("26/10/2026");
    expect(readyNotification("monthly", "X", { since: "2026-10-01", until: "2026-10-31" }).title).toContain("mensal");
  });

  it("builds the failure notice with the reason", () => {
    const n = failedNotification("Aureon", "unreadable");
    expect(n.type).toBe("report_failed");
    expect(n.body).toContain("Meta");
  });

  function fakeDb(enabled: boolean | null, insertError: { message: string } | null = null) {
    const insert = vi.fn().mockResolvedValue({ error: insertError });
    const db = { rpc: vi.fn().mockResolvedValue({ data: enabled }), from: vi.fn(() => ({ insert })) };
    return { db: db as never, insert };
  }

  it("inserts for the person who turned the automation on", async () => {
    const { db, insert } = fakeDb(true);
    await notifyAutomation(db, { accountId: "a", userId: "u", reportId: "r", notice: readyNotification("weekly", "C", { since: "2026-10-26", until: "2026-11-01" }) });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u", account_id: "a", report_id: "r", type: "report_ready" }));
  });

  it("does nothing without a recipient or when the person switched the type off", async () => {
    const a = fakeDb(true);
    await notifyAutomation(a.db, { accountId: "a", userId: null, notice: failedNotification("C", "unreadable") });
    expect(a.insert).not.toHaveBeenCalled();
    const b = fakeDb(false);
    await notifyAutomation(b.db, { accountId: "a", userId: "u", notice: failedNotification("C", "unreadable") });
    expect(b.insert).not.toHaveBeenCalled();
  });

  it("swallows insert errors", async () => {
    const { db } = fakeDb(true, { message: "boom" });
    await expect(notifyAutomation(db, { accountId: "a", userId: "u", notice: failedNotification("C", "unreadable") })).resolves.toBeUndefined();
  });
});
