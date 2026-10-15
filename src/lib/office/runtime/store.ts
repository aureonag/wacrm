/**
 * Backend-only storage for the complete office state, including private chats.
 * Callers must pass the CRM office gate before using an injected admin client.
 * These RPCs are deliberately unavailable to anon/authenticated database roles.
 */
export const AUREON_ACCOUNT_ID = "737433a3-ec29-4e90-b4ba-9989192ca735";

export interface OfficeStoreRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface OfficeStateSnapshot {
  revision: number;
  snapshot: Record<string, unknown> | null;
}

export interface OfficeStateStore {
  load(accountId: string): Promise<OfficeStateSnapshot>;
  compareAndSwap(
    accountId: string,
    expectedRevision: number,
    nextSnapshot: object,
  ): Promise<boolean>;
}

type StoreErrorCode =
  | "OFFICE_STORAGE_ACCESS_DENIED"
  | "OFFICE_STORAGE_INVALID_INPUT"
  | "OFFICE_STORAGE_UNAVAILABLE";

export class OfficeStoreError extends Error {
  readonly status: number;

  constructor(readonly code: StoreErrorCode) {
    const messages = {
      OFFICE_STORAGE_ACCESS_DENIED: "Office access is restricted",
      OFFICE_STORAGE_INVALID_INPUT: "Invalid office state",
      OFFICE_STORAGE_UNAVAILABLE: "Office storage is unavailable",
    };
    super(messages[code]);
    this.name = "OfficeStoreError";
    this.status = code === "OFFICE_STORAGE_ACCESS_DENIED" ? 403
      : code === "OFFICE_STORAGE_INVALID_INPUT" ? 400 : 503;
  }
}

function scopedAccount(accountId: string): string {
  if (typeof accountId !== "string" || accountId.toLowerCase() !== AUREON_ACCOUNT_ID) {
    throw new OfficeStoreError("OFFICE_STORAGE_ACCESS_DENIED");
  }
  return AUREON_ACCOUNT_ID;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate and detach JSON so later mutations cannot alter an in-flight write. */
function jsonSnapshot(value: unknown, code: StoreErrorCode): Record<string, unknown> {
  if (!isObject(value)) throw new OfficeStoreError(code);
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (
        typeof item === "undefined" || typeof item === "function" ||
        typeof item === "symbol" || typeof item === "bigint" ||
        (typeof item === "number" && !Number.isFinite(item))
      ) {
        throw new Error("Not JSON");
      }
      return item;
    });
    if (typeof serialized !== "string") throw new Error("Not JSON");
    const detached: unknown = JSON.parse(serialized);
    if (!isObject(detached)) throw new Error("Not an object");
    return detached;
  } catch {
    throw new OfficeStoreError(code);
  }
}

/**
 * No cache or write retries: the CJS service owns its request queue/working copy.
 * A false CAS result means reload and return a conflict, never overwrite/replay.
 * No environment values, sessions or credentials are read by this adapter.
 */
export function createSupabaseOfficeStore(client: OfficeStoreRpcClient): OfficeStateStore {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await client.rpc(name, args);
      if (!response || response.error) throw new Error("RPC failed");
      return response.data;
    } catch {
      // Do not propagate database messages, request headers, payloads or causes.
      throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    }
  }

  return {
    async load(accountId) {
      const account = scopedAccount(accountId);
      const result = await rpc("office_runtime_load", { p_account_id: account });
      if (
        !isObject(result) || !Number.isSafeInteger(result.revision) ||
        typeof result.revision !== "number" || result.revision < 0 ||
        (result.revision === 0 ? result.snapshot !== null : !isObject(result.snapshot))
      ) {
        throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
      }
      return {
        revision: result.revision,
        snapshot: result.snapshot === null ? null
          : jsonSnapshot(result.snapshot, "OFFICE_STORAGE_UNAVAILABLE"),
      };
    },

    async compareAndSwap(accountId, expectedRevision, nextSnapshot) {
      const account = scopedAccount(accountId);
      if (
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER
      ) {
        throw new OfficeStoreError("OFFICE_STORAGE_INVALID_INPUT");
      }
      const snapshot = jsonSnapshot(nextSnapshot, "OFFICE_STORAGE_INVALID_INPUT");
      const result = await rpc("office_runtime_compare_and_swap", {
        p_account_id: account,
        p_expected_revision: expectedRevision,
        p_snapshot: snapshot,
      });
      if (typeof result !== "boolean") {
        throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
      }
      return result;
    },
  };
}
