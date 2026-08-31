import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Best-effort bridge between the WhatsApp message pipeline and a
 * contact's deals: the first time a message goes in or out on a given
 * day, drop one "Mensagens trocadas" entry into the Atividades tab of
 * every OPEN deal for that contact. Deliberately one entry per
 * deal/day (not per message) — logging every message would flood the
 * timeline on an active conversation.
 *
 * Called from the inbound webhook and the outbound send route, both of
 * which are core messaging paths — this must never throw or slow that
 * flow down, so every failure is swallowed here, not surfaced to the
 * caller.
 */
export async function logMessageActivityForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  try {
    const { data: deals } = await db
      .from("deals")
      .select("id")
      .eq("contact_id", contactId)
      .eq("status", "open");
    if (!deals || deals.length === 0) return;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    for (const deal of deals) {
      const { data: existing } = await db
        .from("deal_activities")
        .select("id")
        .eq("deal_id", deal.id)
        .eq("type", "whatsapp_message")
        .gte("created_at", startOfDay.toISOString())
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      // Unlike the other activity titles (written client-side via
      // next-intl in queries.ts/pipelines pages), this fires from a
      // server route with no request-scoped locale — hardcoded to the
      // app's primary language (pt-BR) rather than plumbing i18n into
      // the messaging pipeline for one string.
      await db.from("deal_activities").insert({
        deal_id: deal.id,
        account_id: accountId,
        type: "whatsapp_message",
        title: "Mensagens trocadas no WhatsApp",
      });
    }
  } catch (err) {
    console.error("[logMessageActivityForContact] failed (non-fatal):", err);
  }
}
