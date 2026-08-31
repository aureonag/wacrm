import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/prospecting/config
 *
 * Any member may read this — the Prospecção page needs to know
 * whether it can run at all before rendering the chat/config UI.
 * Mirrors `/api/ai/config`'s `configured: true/false` shape: never
 * returns the actual credentials, just whether each dependency is
 * usable.
 *
 * `ai_configured` reflects the account's existing BYOK `ai_configs`
 * row (shared with the inbox auto-reply/draft features) — Prospecção
 * intentionally does not have its own separate OpenAI credential.
 * `google_places_configured` reflects the server-only
 * `GOOGLE_PLACES_API_KEY` env var — absence disables just the Google
 * source, never the whole module.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from("ai_configs")
      .select("is_active, api_key")
      .eq("account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("[prospecting/config GET] fetch error:", error);
      return NextResponse.json({ error: "Failed to load configuration" }, { status: 500 });
    }

    const aiConfigured = !!data && data.is_active === true && !!data.api_key;
    const googlePlacesConfigured = !!process.env.GOOGLE_PLACES_API_KEY;

    return NextResponse.json({
      ai_configured: aiConfigured,
      google_places_configured: googlePlacesConfigured,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
