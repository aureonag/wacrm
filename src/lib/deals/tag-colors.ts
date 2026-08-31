/**
 * Color palette for per-deal tags (`deal_tags`), shared by the Kanban
 * card's inline tag editor and the deal detail page. Deliberately the
 * same 8-swatch palette as the account-wide contact tags
 * (`src/components/settings/tag-manager.tsx`) rather than the mockup's
 * 6-swatch OKLCH system — one color language for "a colored tag" across
 * the app.
 */
export const DEAL_TAG_COLORS = [
  { name: "red", value: "#ef4444" },
  { name: "orange", value: "#f97316" },
  { name: "amber", value: "#f59e0b" },
  { name: "emerald", value: "#10b981" },
  { name: "cyan", value: "#06b6d4" },
  { name: "blue", value: "#3b82f6" },
  { name: "violet", value: "#8b5cf6" },
  { name: "pink", value: "#ec4899" },
] as const;
