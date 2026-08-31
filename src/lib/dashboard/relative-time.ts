import type { useTranslations } from "next-intl";

/**
 * Formats an ISO timestamp as "3m ago" style relative time. Shared by
 * the dashboard's ActivityFeed and the deal detail page's Atividades
 * tab — both read the same `Dashboard.activityFeed.time*` keys, which
 * are timestamp-formatting strings, not feed-specific copy.
 */
export function relativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return t("timeS", { sec: Math.max(1, diffSec) });
  if (diffSec < 3600) return t("timeM", { min: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("timeH", { hr: Math.floor(diffSec / 3600) });
  if (diffSec < 2_592_000) return t("timeD", { day: Math.floor(diffSec / 86400) });
  return new Date(iso).toLocaleDateString();
}
