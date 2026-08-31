/**
 * "Frente comercial" — which of Aureon's two service lines a deal
 * belongs to. Shared derivation used by the Kanban card badge, the
 * "Novo negócio" modal, and the deal detail page so the label logic
 * lives in exactly one place.
 */
export type FrenteLabelKey = "both" | "avr" | "leadgen" | null;

export function frenteLabelKey(leadgen?: boolean, avr?: boolean): FrenteLabelKey {
  if (leadgen && avr) return "both";
  if (avr) return "avr";
  if (leadgen) return "leadgen";
  return null;
}
