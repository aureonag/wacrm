/**
 * Formats a next-step's due date the way the mockup shows it: "Amanhã"
 * for tomorrow, "Sex, 22 ago" for a date within the next week, and a
 * plain "28 ago" further out. `t` must resolve `dueToday`/`dueTomorrow`
 * from `Pipelines.detail`.
 */
export function formatStepDueDate(
  dueDate: string,
  locale: string,
  t: (key: "dueToday" | "dueTomorrow") => string,
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0) return t("dueToday");
  if (diffDays === 1) return t("dueTomorrow");

  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(due);
  if (diffDays > 1 && diffDays <= 6) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(due);
    return `${weekday}, ${dayMonth}`;
  }
  return dayMonth;
}
