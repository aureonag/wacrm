/** Codigo curto exibido no card e no drawer: 42 -> "T-0042". */
export function formatTaskCode(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return `T-${String(Math.trunc(n)).padStart(4, "0")}`;
}
