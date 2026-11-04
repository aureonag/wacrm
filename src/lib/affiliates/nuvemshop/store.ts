// Database access of the Nuvemshop integration (server-only). aff_integrations
// has RLS on and no policy: it is reached through the service role only, and
// the token is stored encrypted — never return `token_encrypted` to a browser.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";
import { isModuleNotReady } from "../admin";
import type { StoreAuth } from "./api";

export interface Integration {
  id: string;
  client_id: string | null;
  external_store_id: string;
  store_name: string | null;
  store_url: string | null;
  scopes: string | null;
  status: "connected" | "error" | "revoked";
  last_error: string | null;
  webhooks_ok: boolean;
  installed_at: string;
}

/** Columns that are safe to read (no token). */
export const INTEGRATION_COLUMNS =
  "id, client_id, external_store_id, store_name, store_url, scopes, status, last_error, webhooks_ok, installed_at";

export async function getIntegrationByStoreId(storeId: string, admin: SupabaseClient = supabaseAdmin()): Promise<Integration | null> {
  const { data, error } = await admin
    .from("aff_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("platform", "nuvemshop")
    .eq("external_store_id", storeId)
    .maybeSingle();
  if (error) {
    if (isModuleNotReady(error)) return null; // migration 162 not applied yet
    throw new Error(`aff_integrations read failed: ${error.message}`);
  }
  return (data as Integration | null) ?? null;
}

/** The store in use by a client (connected or with an error), if any. */
export async function getIntegrationForClient(clientId: string, admin: SupabaseClient = supabaseAdmin()): Promise<Integration | null> {
  const { data, error } = await admin
    .from("aff_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("platform", "nuvemshop")
    .eq("client_id", clientId)
    .neq("status", "revoked")
    .maybeSingle();
  if (error) {
    if (isModuleNotReady(error)) return null; // migration 162 not applied yet
    throw new Error(`aff_integrations read failed: ${error.message}`);
  }
  return (data as Integration | null) ?? null;
}

/** Stores that installed the app on their own and wait for the team to link them to a client. */
export async function listPendingIntegrations(admin: SupabaseClient = supabaseAdmin()): Promise<Integration[]> {
  const { data, error } = await admin
    .from("aff_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("platform", "nuvemshop")
    .is("client_id", null)
    .neq("status", "revoked")
    .order("installed_at", { ascending: false })
    .limit(50);
  if (error) {
    if (isModuleNotReady(error)) return [];
    throw new Error(`aff_integrations read failed: ${error.message}`);
  }
  return (data ?? []) as Integration[];
}

export async function getStoreAuth(integrationId: string, admin: SupabaseClient = supabaseAdmin()): Promise<StoreAuth | null> {
  const { data, error } = await admin
    .from("aff_integrations")
    .select("external_store_id, token_encrypted")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new Error(`aff_integrations read failed: ${error.message}`);
  if (!data) return null;
  try {
    return { externalStoreId: data.external_store_id as string, token: decrypt(data.token_encrypted as string) };
  } catch {
    // The key changed or the row is damaged: the store has to be reconnected.
    console.error("[nuvemshop] could not decrypt the token of integration", integrationId);
    return null;
  }
}

export async function saveIntegration(
  input: {
    clientId: string | null;
    storeId: string;
    storeName: string | null;
    storeUrl: string | null;
    token: string;
    scopes: string | null;
  },
  admin: SupabaseClient = supabaseAdmin(),
): Promise<Integration> {
  const { data, error } = await admin
    .from("aff_integrations")
    .upsert(
      {
        platform: "nuvemshop",
        external_store_id: input.storeId,
        // On a reinstall without a client the existing link is kept (see completeInstall).
        client_id: input.clientId,
        store_name: input.storeName,
        store_url: input.storeUrl,
        token_encrypted: encrypt(input.token),
        scopes: input.scopes,
        status: "connected",
        last_error: null,
        installed_at: new Date().toISOString(),
      },
      { onConflict: "platform,external_store_id" },
    )
    .select(INTEGRATION_COLUMNS)
    .single();
  if (error) throw new Error(`aff_integrations save failed: ${error.message}`);
  return data as Integration;
}

export async function patchIntegration(
  id: string,
  patch: Partial<{ status: Integration["status"]; last_error: string | null; webhooks_ok: boolean; client_id: string | null }>,
  admin: SupabaseClient = supabaseAdmin(),
): Promise<void> {
  const { error } = await admin.from("aff_integrations").update(patch).eq("id", id);
  if (error) console.error("[nuvemshop] could not update integration", id, error.message);
}
