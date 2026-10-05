import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteDealsBulk, loadDealIdsWithPaperwork } from "./queries";

type Result = { data: unknown[] | null; error: { message: string } | null };

/** Minimal fake of the `from(table).select/delete().in().select()` chains used here. */
function fakeDb(handlers: { select?: (table: string, ids: string[]) => Result; del?: (ids: string[]) => Result }) {
  const calls: { op: string; table: string; ids: string[] }[] = [];
  const db = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            in(_col: string, ids: string[]) {
              calls.push({ op: "select", table, ids });
              return Promise.resolve(handlers.select?.(table, ids) ?? { data: [], error: null });
            },
          };
        },
        delete() {
          return {
            in(_col: string, ids: string[]) {
              return {
                select(_cols: string) {
                  calls.push({ op: "delete", table, ids });
                  return Promise.resolve(handlers.del?.(ids) ?? { data: ids.map((id) => ({ id })), error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `deal-${i}`);

describe("loadDealIdsWithPaperwork", () => {
  it("returns the deals that have a contract or a closing sheet, from both tables", async () => {
    const { db } = fakeDb({
      select: (table) =>
        table === "deal_contracts"
          ? { data: [{ deal_id: "deal-1" }], error: null }
          : { data: [{ deal_id: "deal-2" }], error: null },
    });
    const result = await loadDealIdsWithPaperwork(db, ["deal-0", "deal-1", "deal-2"]);
    expect([...result].sort()).toEqual(["deal-1", "deal-2"]);
  });

  it("chunks long id lists so the request never gets too large", async () => {
    const { db, calls } = fakeDb({});
    await loadDealIdsWithPaperwork(db, ids(200));
    const contractCalls = calls.filter((c) => c.table === "deal_contracts");
    expect(contractCalls).toHaveLength(3); // 80 + 80 + 40
    expect(Math.max(...contractCalls.map((c) => c.ids.length))).toBeLessThanOrEqual(80);
  });
});

describe("deleteDealsBulk", () => {
  it("deletes in chunks and reports the exact count", async () => {
    const { db, calls } = fakeDb({});
    const result = await deleteDealsBulk(db, ids(170));
    expect(result).toEqual({ deleted: 170, requested: 170, failed: false });
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(3);
  });

  it("counts only rows really deleted (RLS may skip some) and flags a failed chunk", async () => {
    let call = 0;
    const { db } = fakeDb({
      del: (chunk) => {
        call += 1;
        if (call === 2) return { data: null, error: { message: "boom" } };
        return { data: chunk.slice(0, chunk.length - 1).map((id) => ({ id })), error: null };
      },
    });
    const result = await deleteDealsBulk(db, ids(170));
    expect(result.requested).toBe(170);
    expect(result.failed).toBe(true);
    expect(result.deleted).toBe(79 + 9); // chunk1 79 of 80, chunk2 failed, chunk3 9 of 10
  });

  it("does nothing for an empty selection", async () => {
    const { db, calls } = fakeDb({});
    expect(await deleteDealsBulk(db, [])).toEqual({ deleted: 0, requested: 0, failed: false });
    expect(calls).toHaveLength(0);
  });
});
