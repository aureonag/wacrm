/**
 * Where a person lands right after signing in, from their sectors:
 *  - only Operacional sectors (Criação / Mídia / Social) -> Operacional;
 *  - Comercial, no sector at all, or a mix of both -> stay in the CRM.
 * Returns null when the person should stay on the default CRM dashboard.
 */
const OPERATIONAL_SECTORS = new Set(["criacao", "midia", "social", "social media"]);

function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function landingPathFor(sectorNames: string[]): string | null {
  const names = sectorNames.map(norm).filter(Boolean);
  if (names.length === 0) return null;
  const operational = names.filter((n) => OPERATIONAL_SECTORS.has(n));
  if (operational.length === 0) return null;
  if (operational.length < names.length) return null; // also in Comercial (or another CRM sector)
  return "/operational/dashboard";
}
