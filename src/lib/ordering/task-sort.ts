// "Ordenar por" of a board stage: sorts the stage's tasks by one field and the
// result becomes the person's own order of that column (see column-order.ts).
// Dates: soonest first, tasks without a date last. "Criada em": newest first.
// Texts: A to Z, empty last. Ties keep the order the tasks already had.

export type TaskSortKey = "startDate" | "dueDate" | "createdAt" | "client" | "project" | "title";

export interface SortableTask {
  id: string;
  title: string;
  start_date?: string | null;
  due_date?: string | null;
  created_at: string;
  project?: { name?: string | null; client_name?: string | null } | null;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x && !y) return 0;
  if (!x) return 1; // empty last
  if (!y) return -1;
  return collator.compare(x, y);
}

function compareDate(a: string | null | undefined, b: string | null | undefined, newestFirst = false): number {
  if (!a && !b) return 0;
  if (!a) return 1; // no date last
  if (!b) return -1;
  const diff = a < b ? -1 : a > b ? 1 : 0;
  return newestFirst ? -diff : diff;
}

/** Ids of `tasks` sorted by `key` (stable). */
export function sortTaskIds(tasks: SortableTask[], key: TaskSortKey): string[] {
  const indexed = tasks.map((task, index) => ({ task, index }));
  indexed.sort((p, q) => {
    let result = 0;
    switch (key) {
      case "startDate":
        result = compareDate(p.task.start_date, q.task.start_date);
        break;
      case "dueDate":
        result = compareDate(p.task.due_date, q.task.due_date);
        break;
      case "createdAt":
        result = compareDate(p.task.created_at, q.task.created_at, true);
        break;
      case "client":
        result = compareText(p.task.project?.client_name, q.task.project?.client_name);
        break;
      case "project":
        result = compareText(p.task.project?.name, q.task.project?.name);
        break;
      case "title":
        result = compareText(p.task.title, q.task.title);
        break;
    }
    return result !== 0 ? result : p.index - q.index;
  });
  return indexed.map((entry) => entry.task.id);
}
