import type { Task } from "@/types";
import { formatTaskCode } from "./code";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Board search: every word typed must appear somewhere in the task's
 * title, code (T-0042 or just 42), client, assignee or tags.
 */
export function matchesTaskQuery(task: Task, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const code = formatTaskCode(task.task_number);
  const haystack = norm(
    [
      task.title,
      code ?? "",
      code ? String(task.task_number) : "",
      task.contact?.name ?? "",
      task.assignee?.full_name ?? "",
      ...(task.tags ?? []).map((t) => t.label),
    ].join(" "),
  );
  return words.every((w) => haystack.includes(w));
}
