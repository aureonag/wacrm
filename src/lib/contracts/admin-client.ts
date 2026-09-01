import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy, shared service-role client for the Contrato feature's public
// (anonymous) routes — /api/contracts/[token]/* and the Clicksign
// webhook all touch `deal_contracts` in ways RLS doesn't (and shouldn't)
// permit an anon/authenticated key to do directly. Mirrors
// src/lib/prospecting/admin-client.ts — same shape, kept separate per
// module rather than shared, per this codebase's convention. Only ever
// import this from server-only code — never from a client component.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
