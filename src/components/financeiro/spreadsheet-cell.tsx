"use client";

// ============================================================
// Small always-editable cells shared by every full-year grid in the
// Financeiro module (Linhas de serviço's clients/allocations, Despesas'
// categories) so their look/behavior stays identical across tabs.
// `resetKey` forces the uncontrolled input to remount (and pick up the
// new defaultValue) when the underlying value or the selected year
// changes.
// ============================================================

/** "1094" | "1094,5" | "1094.5" -> 1094.5. Empty/unparseable -> undefined. */
function parseAmount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** 1094 -> "1094,00". Always 2 decimals, comma separator — never bare "1094". */
function formatAmount(value: number | undefined): string {
  return value === undefined ? "" : value.toFixed(2).replace(".", ",");
}

// `type="text"` rather than `type="number"`: a native number input both
// rejects "," outright in most browsers (blocking the very format this
// column needs) and renders trailing zeros verbatim (1094.5 shows as
// "1094.5", not "1094,50") — neither survives a round trip through
// `formatAmount`. This owns its own parsing/formatting instead.
export function MonthCell({
  value,
  resetKey,
  onSave,
}: {
  value: number | undefined;
  resetKey: string;
  onSave: (raw: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      key={resetKey}
      defaultValue={formatAmount(value)}
      onBlur={(e) => {
        // Only persist an actual edit — an incidental focus/blur (e.g.
        // tabbing through, or a stray click) must never write a 0 over
        // an empty cell.
        const next = parseAmount(e.target.value);
        if (next !== value) {
          onSave(e.target.value);
        } else {
          // No real change, but still normalize the display (e.g. "1094" -> "1094,00").
          e.target.value = formatAmount(value);
        }
      }}
      placeholder="—"
      className="h-8 w-[84px] rounded-md border border-transparent bg-transparent px-1.5 text-right text-xs text-foreground outline-none hover:border-border focus:border-primary focus:bg-muted"
    />
  );
}

/** Same idea, for a free-text label column (e.g. "CODE - Name", a category name). */
export function DescriptionCell({
  value,
  resetKey,
  onSave,
}: {
  value: string;
  resetKey: string;
  onSave: (raw: string) => void;
}) {
  return (
    <input
      type="text"
      key={resetKey}
      defaultValue={value}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next && next !== value.trim()) onSave(next);
      }}
      className="h-8 w-full min-w-[210px] rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium text-foreground outline-none hover:border-border focus:border-primary focus:bg-muted"
    />
  );
}
