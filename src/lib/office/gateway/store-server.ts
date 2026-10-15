import { createClient } from "@supabase/supabase-js";
import { AUREON_ACCOUNT_ID, createSupabaseOfficeStore, OfficeStoreError, type OfficeStateStore, type OfficeStoreRpcClient } from "../runtime/store";

let store: OfficeStateStore | undefined;
let serverClient: OfficeStoreRpcClient | undefined;

/** Server-to-server only. No browser identity or default transport can authorize this callback. */
export function requireOfficeBackendStoreScope(): string {
  if (process.env.AUREON_OFFICE_ENABLED !== "true" || process.env.AUREON_OFFICE_TRANSPORT !== "gateway" ||
    process.env.AUREON_OFFICE_ACCOUNT_ID?.trim().toLowerCase() !== AUREON_ACCOUNT_ID) {
    throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
  }
  return AUREON_ACCOUNT_ID;
}

/** Server credentials stay in the CRM and are read only after verified callback dispatch. */
function getServerClient(): OfficeStoreRpcClient {
  if (!serverClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    serverClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return serverClient;
}

/** Cross-worker replay gate. False is a replay; RPC/input failures never fall back to memory. */
export async function claimOfficeBackendNonce(accountId: string, nonce: string, issuedAtMs: number): Promise<boolean> {
  try {
    const account = requireOfficeBackendStoreScope();
    if (accountId !== account || typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce) ||
      !Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
      throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    }
    const response = await getServerClient().rpc("office_gateway_claim_nonce", {
      p_account_id: account, p_nonce: nonce, p_issued_at_ms: issuedAtMs,
    });
    if (!response || response.error || typeof response.data !== "boolean") {
      throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    }
    return response.data;
  } catch {
    throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
  }
}

/** Read server credentials lazily, only after HMAC, DTO and durable nonce validation. */
export function getOfficeBackendStore(): OfficeStateStore {
  requireOfficeBackendStoreScope();
  if (!store) store = createSupabaseOfficeStore(getServerClient());
  return store;
}
