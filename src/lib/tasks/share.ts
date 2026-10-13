// Sharing a task: every task has its own link, internal to the CRM. Anyone who
// opens it must be signed in (the login brings them back to the task) and have
// access to Operacional — nothing is public.

/** Path of a task inside the CRM: its board with the task panel open. */
export function taskPath(task: { board_id: string; id: string }): string {
  return `/operational/boards/${task.board_id}?task=${task.id}`;
}

/** Full link (needs the site origin, e.g. https://aureonag.com). */
export function taskShareUrl(origin: string, task: { board_id: string; id: string }): string {
  return `${origin.replace(/\/+$/, "")}${taskPath(task)}`;
}

/** WhatsApp "send" link with a ready message; the person picks the contact there. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
