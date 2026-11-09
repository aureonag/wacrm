// The Meta events a client counts its leads and purchases with, and the attribution windows of
// a link. Chosen by a person; checked here. Pure.

import { ATTRIBUTION_WINDOWS, CONVERSATION_ACTION } from "./meta-ads";

/** Suggested events for the pickers (any other well-formed event type is accepted too: accounts differ). */
export const LEAD_EVENT_OPTIONS = ["lead", CONVERSATION_ACTION, "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"] as const;
export const eventLabel = (event: string): string => event === CONVERSATION_ACTION ? "Conversas por mensagem iniciadas" : event;
export const PURCHASE_EVENT_OPTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"] as const;

/** An event type from untrusted input: undefined = invalid, null = the canonical events, otherwise the exact type. */
export function parseEventType(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return /^[A-Za-z0-9_.]{1,100}$/.test(t) ? t : undefined;
}

/** Attribution windows from untrusted input: undefined = invalid, null = whatever Meta applies by default. */
export function parseAttributionWindows(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 4) return undefined;
  const list = [...new Set(v)];
  if (!list.every((w): w is string => typeof w === "string" && (ATTRIBUTION_WINDOWS as readonly string[]).includes(w))) return undefined;
  return list;
}

/** What to tell the person about the attribution a read used. */
export function attributionLabel(a: { requested: string[] | null; mode: "meta_default" | "explicit"; effective: string | null } | undefined): string {
  if (!a) return "Atribuição: não registrada neste relatório.";
  if (a.mode === "explicit") return `Atribuição pedida: ${a.requested?.join(", ")}${a.effective ? `; aplicada pela Meta: ${a.effective}` : "; a Meta não informou a aplicada"}.`;
  return a.effective ? `Atribuição aplicada pela Meta: ${a.effective}.` : "Atribuição: padrão da Meta (a Meta não informou qual).";
}
