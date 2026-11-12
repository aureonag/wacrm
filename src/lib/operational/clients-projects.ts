// Operacional → Clientes e Projetos (migration 106): shared types, validation
// and task-count helpers for the API routes. Pure and server/client safe.

export type ClientStatus = "active" | "inactive";
export type ProjectStatus = "active" | "archived";

export interface TaskCounts {
  total: number;
  open: number;
  done: number;
  overdue: number;
}

export const EMPTY_COUNTS: TaskCounts = { total: 0, open: 0, done: 0, overdue: 0 };

export class ValidationError extends Error {
  readonly status = 400 as const;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, max: number, field: string, required = false): string | null {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`Informe ${field}.`);
    return null;
  }
  if (typeof v !== "string") throw new ValidationError(`${field} inválido.`);
  const s = v.trim();
  if (!s) {
    if (required) throw new ValidationError(`Informe ${field}.`);
    return null;
  }
  if (s.length > max) throw new ValidationError(`${field} muito longo.`);
  return s;
}

function date(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new ValidationError(`${field} inválida.`);
  return v;
}

/**
 * Client / contract number, standardized: digits only become 5 digits with
 * leading zeros ("80" -> "00080", "351" -> "00351"); anything else is kept
 * trimmed; empty -> null. Same format as the number in the kickoff task title
 * ("Kickoff - 00351 - CG Complemento") and as the Runrun client code.
 */
export function normalizeClientCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  return /^\d{1,5}$/.test(s) ? s.padStart(5, "0") : s;
}

/** The contract number at the start of a deal / task title: "00351 - CG Complemento", "Kickoff - 00351 - ...". */
export function extractCodeFromTitle(title: string | null | undefined): string | null {
  const m = /^\s*(?:kickoff\s*-\s*)?(\d{3,6})\s*-\s*\S/i.exec(title ?? "");
  return m ? normalizeClientCode(m[1]) : null;
}

export interface ClientInput {
  name: string;
  code: string | null;
  status: ClientStatus;
  notes: string | null;
}

/** Create: name required. Update (`partial`): only the keys present are validated/returned. */
export function parseClientInput(body: unknown, partial = false): Partial<ClientInput> & { name?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<ClientInput> = {};
  if (!partial || "name" in b) out.name = text(b.name, 200, "o nome do cliente", true)!;
  if (!partial || "code" in b) out.code = normalizeClientCode(text(b.code, 40, "o código"));
  if ("status" in b) {
    if (b.status !== "active" && b.status !== "inactive") throw new ValidationError("Situação inválida.");
    out.status = b.status;
  } else if (!partial) {
    out.status = "active";
  }
  if (!partial || "notes" in b) out.notes = text(b.notes, 5000, "as observações");
  return out;
}

export interface ProjectInput {
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
}

export function parseProjectInput(body: unknown, partial = false): Partial<ProjectInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<ProjectInput> = {};
  if (!partial || "name" in b) out.name = text(b.name, 200, "o nome do projeto", true)!;
  if (!partial || "description" in b) out.description = text(b.description, 5000, "a descrição");
  if ("status" in b) {
    if (b.status !== "active" && b.status !== "archived") throw new ValidationError("Situação inválida.");
    out.status = b.status;
  } else if (!partial) {
    out.status = "active";
  }
  if (!partial || "start_date" in b) out.start_date = date(b.start_date, "A data de início");
  if (!partial || "due_date" in b) out.due_date = date(b.due_date, "A data de entrega");
  if (out.start_date && out.due_date && out.due_date < out.start_date) {
    throw new ValidationError("A entrega não pode ser antes do início.");
  }
  return out;
}

/**
 * Whether a board stage is a "finished" column ("Concluído", "Concluída",
 * "Finalizado"…). Moving a card into it does not flip the task's own `status`
 * (that stays "open" until someone marks it), so the overview has to look at
 * the stage too, or a delivered task keeps showing as open / overdue.
 */
export function isDoneStageName(name: string | null | undefined): boolean {
  const n = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return /^(concluid|finalizad)[oa]s?$/.test(n);
}

/** A task counts as completed when it is marked done OR sits in a finished stage. */
export const isTaskCompleted = (status: string, stageDone: boolean | undefined) => status === "done" || stageDone === true;

/**
 * Delivered late: finished after its due date. Both are YYYY-MM-DD (the
 * completion date already in São Paulo time). Unknown completion date → not
 * flagged, rather than guessing.
 */
export function deliveredLate(completedOn: string | null | undefined, dueDate: string | null | undefined): boolean {
  return Boolean(completedOn && dueDate && completedOn > dueDate);
}

/**
 * Folds task rows into per-key counts. A completed task (done, or in a finished
 * stage — see `stage_done`) is never overdue, even when it was delivered after
 * its due date: that is shown separately as "entregue com atraso". Only an
 * open task past its due date is overdue.
 */
export function countTasks(
  rows: { key: string; status: string; due_date: string | null; stage_done?: boolean }[],
  today: string,
): Map<string, TaskCounts> {
  const map = new Map<string, TaskCounts>();
  for (const r of rows) {
    const c = map.get(r.key) ?? { ...EMPTY_COUNTS };
    c.total += 1;
    if (isTaskCompleted(r.status, r.stage_done)) c.done += 1;
    else {
      c.open += 1;
      if (r.due_date && r.due_date < today) c.overdue += 1;
    }
    map.set(r.key, c);
  }
  return map;
}

export const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
