import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy, shared service-role client for the prospecting engine/cron.
// Mirrors src/lib/automations/admin-client.ts — same shape so anyone
// reading either file picks up the convention immediately. Only ever
// import this from server-only code (API routes, the engine) — never
// from a client component.
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
