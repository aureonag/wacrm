import { describe, expect, it, vi } from "vitest";

import {
  AUREON_ACCOUNT_ID,
  createSupabaseOfficeStore,
  OfficeStoreError,
  type OfficeStoreRpcClient,
} from "./store";

const OTHER_ACCOUNT = "11111111-1111-4111-8111-111111111111";

function backend() {
  let state: { revision: number; snapshot: Record<string, unknown> } | null = null;
  // Atomic RPC boundary mock. This does not validate PostgreSQL permissions/locking.
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "office_runtime_load") {
      return { data: state ? structuredClone(state) : { revision: 0, snapshot: null }, error: null };
    }
    if (name !== "office_runtime_compare_and_swap") throw new Error("Unexpected RPC");
    if ((state?.revision ?? 0) !== args.p_expected_revision) return { data: false, error: null };
    state = {
      revision: (state?.revision ?? 0) + 1,
      snapshot: structuredClone(args.p_snapshot) as Record<string, unknown>,
    };
    return { data: true, error: null };
  });
  return { rpc };
}

describe("Supabase office snapshot store", () => {
  it("loads the initial revision zero without creating a snapshot", async () => {
    const client = backend();
    const store = createSupabaseOfficeStore(client);
    await expect(store.load(AUREON_ACCOUNT_ID)).resolves.toEqual({ revision: 0, snapshot: null });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("office_runtime_load", {
      p_account_id: AUREON_ACCOUNT_ID,
    });
  });

  it("creates with CAS zero, updates the expected revision and preserves the full JSON", async () => {
    const client = backend();
    const store = createSupabaseOfficeStore(client);
    const snapshot = {
      version: 1,
      map: { seedVersion: "aureon-office-v1", objects: [{ id: "desk" }] },
      users: [{ id: "crm-user", avatar: { hair: "short" }, preferences: { sound: false } }],
      messages: [{ text: "private fixture", recipients: ["crm-user"] }],
    };
    await expect(store.compareAndSwap(AUREON_ACCOUNT_ID, 0, snapshot)).resolves.toBe(true);
    await expect(store.load(AUREON_ACCOUNT_ID)).resolves.toEqual({ revision: 1, snapshot });
    await expect(store.compareAndSwap(AUREON_ACCOUNT_ID, 1, { ...snapshot, marker: "next" })).resolves.toBe(true);
    await expect(store.load(AUREON_ACCOUNT_ID)).resolves.toEqual({
      revision: 2, snapshot: { ...snapshot, marker: "next" },
    });
    expect(client.rpc).toHaveBeenCalledWith("office_runtime_compare_and_swap", {
      p_account_id: AUREON_ACCOUNT_ID, p_expected_revision: 0, p_snapshot: snapshot,
    });
  });

  it("returns false for a losing initial writer without replacing the first seed", async () => {
    const client = backend();
    const a = createSupabaseOfficeStore(client), b = createSupabaseOfficeStore(client);
    await expect(a.compareAndSwap(AUREON_ACCOUNT_ID, 0, { seed: "first" })).resolves.toBe(true);
    await expect(b.compareAndSwap(AUREON_ACCOUNT_ID, 0, { seed: "stale" })).resolves.toBe(false);
    await expect(b.load(AUREON_ACCOUNT_ID)).resolves.toEqual({ revision: 1, snapshot: { seed: "first" } });
  });

  it("does not retry or lose another instance's update after a revision conflict", async () => {
    const client = backend();
    const a = createSupabaseOfficeStore(client), b = createSupabaseOfficeStore(client);
    await a.compareAndSwap(AUREON_ACCOUNT_ID, 0, { value: "seed" });
    const [oldA, oldB] = await Promise.all([a.load(AUREON_ACCOUNT_ID), b.load(AUREON_ACCOUNT_ID)]);
    await expect(a.compareAndSwap(AUREON_ACCOUNT_ID, oldA.revision, { value: "winner" })).resolves.toBe(true);
    const callsBefore = client.rpc.mock.calls.length;
    await expect(b.compareAndSwap(AUREON_ACCOUNT_ID, oldB.revision, { value: "stale" })).resolves.toBe(false);
    expect(client.rpc.mock.calls).toHaveLength(callsBefore + 1);
    await expect(b.load(AUREON_ACCOUNT_ID)).resolves.toEqual({ revision: 2, snapshot: { value: "winner" } });
  });

  it("loads fresh data on every call and detaches loaded/in-flight snapshots", async () => {
    const client = backend();
    const store = createSupabaseOfficeStore(client);
    const input = { nested: { value: "before" } };
    const commit = store.compareAndSwap(AUREON_ACCOUNT_ID, 0, input);
    input.nested.value = "caller mutation";
    await commit;
    const first = await store.load(AUREON_ACCOUNT_ID);
    (first.snapshot!.nested as { value: string }).value = "read mutation";
    await expect(store.load(AUREON_ACCOUNT_ID)).resolves.toEqual({
      revision: 1, snapshot: { nested: { value: "before" } },
    });
    expect(client.rpc.mock.calls.filter(([name]) => name === "office_runtime_load")).toHaveLength(2);
  });

  it.each([OTHER_ACCOUNT, "", "*", " "])("rejects another/missing account before any RPC (%s)", async account => {
    const client = backend();
    const store = createSupabaseOfficeStore(client);
    await expect(store.load(account)).rejects.toMatchObject({ status: 403, code: "OFFICE_STORAGE_ACCESS_DENIED" });
    await expect(store.compareAndSwap(account, 0, {})).rejects.toMatchObject({ status: 403 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    "rejects an invalid expected revision before any RPC (%s)", async revision => {
      const client = backend();
      await expect(createSupabaseOfficeStore(client).compareAndSwap(AUREON_ACCOUNT_ID, revision, {}))
        .rejects.toMatchObject({ code: "OFFICE_STORAGE_INVALID_INPUT" });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([null, [], "text", { value: undefined }, { value: Number.NaN }, { value: BigInt(1) }])(
    "rejects non-JSON/object snapshots before writing (%o)", async snapshot => {
      const client = backend();
      await expect(createSupabaseOfficeStore(client).compareAndSwap(AUREON_ACCOUNT_ID, 0, snapshot as object))
        .rejects.toMatchObject({ code: "OFFICE_STORAGE_INVALID_INPUT" });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects cyclic payloads without leaking their content", async () => {
    const client = backend();
    const snapshot: Record<string, unknown> = { privateText: "not-in-errors" };
    snapshot.self = snapshot;
    await expect(createSupabaseOfficeStore(client).compareAndSwap(AUREON_ACCOUNT_ID, 0, snapshot))
      .rejects.toThrow("Invalid office state");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    undefined, [], { revision: 0 }, { revision: 1, snapshot: null },
    { revision: -1, snapshot: {} }, { revision: "1", snapshot: {} },
    { revision: Number.MAX_SAFE_INTEGER + 1, snapshot: {} },
  ])("fails closed on malformed load responses (%j)", async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(createSupabaseOfficeStore({ rpc }).load(AUREON_ACCOUNT_ID))
      .rejects.toMatchObject({ status: 503, code: "OFFICE_STORAGE_UNAVAILABLE" });
  });

  it.each([null, "false", { committed: true }])("does not treat a malformed CAS result as success (%j)", async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(createSupabaseOfficeStore({ rpc }).compareAndSwap(AUREON_ACCOUNT_ID, 0, {}))
      .rejects.toBeInstanceOf(OfficeStoreError);
  });

  it.each(["response", "rejection"])("sanitizes database/transport errors (%s)", async mode => {
    const secret = "test-secret-must-not-escape";
    const rpc = mode === "response"
      ? vi.fn().mockResolvedValue({ data: null, error: { message: secret, details: secret } })
      : vi.fn().mockRejectedValue(new Error(secret));
    const store = createSupabaseOfficeStore({ rpc } satisfies OfficeStoreRpcClient);
    for (const operation of [() => store.load(AUREON_ACCOUNT_ID), () => store.compareAndSwap(AUREON_ACCOUNT_ID, 0, {})]) {
      try {
        await operation();
        throw new Error("Expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(OfficeStoreError);
        expect((error as Error).message).toBe("Office storage is unavailable");
        expect(String(error) + JSON.stringify(error)).not.toContain(secret);
        expect(error).not.toHaveProperty("cause");
      }
    }
  });
});
