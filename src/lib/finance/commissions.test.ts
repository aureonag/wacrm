import { describe, expect, it } from "vitest";
import {
  buildCommissionGrid,
  commissionsInMonth,
  displayClient,
  formatDayMonth,
  type CommissionRow,
} from "./commissions";

const row = (over: Partial<CommissionRow>): CommissionRow => ({
  id: Math.random().toString(),
  recipient_name: "Felipe Cordeiro Queiroz",
  client_label: "00350 - Dr Aline Bueno",
  pct: 100,
  base_amount: 1000,
  amount: 1000,
  due_date: "2026-10-15",
  ...over,
});

describe("commissionsInMonth", () => {
  it("keeps only the month and sorts by day, then name", () => {
    const rows = [
      row({ id: "c", due_date: "2026-10-20", recipient_name: "Bruna" }),
      row({ id: "a", due_date: "2026-10-05", recipient_name: "Zé" }),
      row({ id: "b", due_date: "2026-10-05", recipient_name: "Ana" }),
      row({ id: "x", due_date: "2026-11-01" }),
      row({ id: "y", due_date: "2025-10-05" }),
    ];
    expect(commissionsInMonth(rows, 2026, 10).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});

describe("buildCommissionGrid", () => {
  it("sums per person and month, with row, column and grand totals", () => {
    const grid = buildCommissionGrid(
      [
        row({ recipient_name: "Ana", due_date: "2026-01-10", amount: 100.1 }),
        row({ recipient_name: "Ana", due_date: "2026-01-20", amount: 200.2 }),
        row({ recipient_name: "Ana", due_date: "2026-03-05", amount: 50 }),
        row({ recipient_name: "Bruno", due_date: "2026-01-02", amount: 10 }),
        row({ recipient_name: "Bruno", due_date: "2025-12-31", amount: 999 }),
      ],
      2026,
    );
    expect(grid.rows.map((r) => r.recipient)).toEqual(["Ana", "Bruno"]);
    expect(grid.rows[0].months[0]).toBe(300.3);
    expect(grid.rows[0].months[2]).toBe(50);
    expect(grid.rows[0].total).toBe(350.3);
    expect(grid.monthTotals[0]).toBe(310.3);
    expect(grid.grandTotal).toBe(360.3);
  });
  it("is empty when nothing is due that year", () => {
    const grid = buildCommissionGrid([row({ due_date: "2025-05-01" })], 2026);
    expect(grid.rows).toEqual([]);
    expect(grid.grandTotal).toBe(0);
  });
});

describe("display helpers", () => {
  it("shows code and name without the complement", () => {
    expect(displayClient("00349 - ProSport | Fabricante Dryfit")).toBe("00349 - ProSport");
    expect(displayClient("Sem código")).toBe("Sem código");
  });
  it("formats the day and month", () => {
    expect(formatDayMonth("2026-10-05")).toBe("05/10");
  });
});
