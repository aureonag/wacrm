import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));
vi.mock("../admin-client", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { cancelarPesquisa, consultarStatusDaPesquisa } from "./status";
import { ProspectingToolError } from "./errors";

function fakeDb(row: unknown) {
  const builder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  mocks.supabaseAdmin.mockReset();
});

describe("consultarStatusDaPesquisa", () => {
  it("rejects a run id belonging to a different account, even a well-formed one", async () => {
    const db = fakeDb(null) as never; // eq(account_id, ...) finds nothing -> not this account's run
    await expect(
      consultarStatusDaPesquisa(db, "acct-1", { run_id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toMatchObject({ code: "run_not_found" });
  });

  it("requires run_id", async () => {
    await expect(consultarStatusDaPesquisa({} as never, "acct-1", {})).rejects.toBeInstanceOf(ProspectingToolError);
  });

  it("returns the run's status fields when found", async () => {
    const db = fakeDb({ id: "run-1", status: "enriching", found_count: 5 }) as never;
    const result = await consultarStatusDaPesquisa(db, "acct-1", { run_id: "run-1" });
    expect(result).toEqual({ id: "run-1", status: "enriching", found_count: 5 });
  });
});

describe("cancelarPesquisa", () => {
  it("rejects cancelling a run that already ended", async () => {
    const db = fakeDb({ id: "run-1", status: "completed" }) as never;
    await expect(cancelarPesquisa(db, "acct-1", { run_id: "run-1" })).rejects.toMatchObject({
      code: "run_already_terminal",
    });
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("cancels a non-terminal run via the admin client", async () => {
    const db = fakeDb({ id: "run-1", status: "searching" }) as never;
    const update = vi.fn(() => ({ eq }));
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.supabaseAdmin.mockReturnValue({ from: vi.fn(() => ({ update })) });

    const result = await cancelarPesquisa(db, "acct-1", { run_id: "run-1" });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    expect(result).toEqual({ run_id: "run-1", status: "cancelled" });
  });
});
