// Pure helpers for the Timesheet feature (Etapa 2, Fase 4) — duration
// math and formatting, kept dependency-free so they're trivially
// testable without a Supabase client or React tree.

/** Minutes between two ISO timestamps, rounded to the nearest minute,
 *  floored at 1 so a sub-minute entry never shows as "0min". */
export function minutesBetween(startedAt: string, endedAt: string): number {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(1, Math.round(ms / 60_000));
}

/** "90" -> "1h 30min"; "45" -> "45min"; "120" -> "2h". */
export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Live elapsed time for a running timer, "H:MM:SS" (or "MM:SS" under an
 *  hour) — the compact clock-face format for the ticking Header badge. */
export function formatElapsedClock(startedAt: string, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---- Kanban card: total + per-person time -------------------------------

/** One timesheet row as the board needs it (only what the card shows). */
export interface CardTimeEntry {
  user_id: string | null;
  started_at: string;
  /** null = the timer is running right now. */
  ended_at: string | null;
  /** Name of whoever tracked it (hydrated by the loader). */
  name?: string | null;
}

export interface PersonTime {
  userId: string;
  name: string;
  seconds: number;
  running: boolean;
}

export interface TaskTimeSummary {
  totalSeconds: number;
  people: PersonTime[];
  /** Someone has a timer open on this task. */
  running: boolean;
}

/**
 * Total and per-person time of a task. Closed entries count their exact
 * duration; an open entry counts up to `nowMs`, so the card can tick without
 * touching the database. Pausing and resuming are just closing and opening
 * rows, so the sums survive reloads and several people working in parallel.
 */
export function summarizeTaskTime(entries: CardTimeEntry[] | undefined, nowMs: number): TaskTimeSummary {
  const byUser = new Map<string, PersonTime>();
  for (const e of entries ?? []) {
    const start = new Date(e.started_at).getTime();
    const end = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    const key = e.user_id ?? "unknown";
    const person = byUser.get(key) ?? { userId: key, name: e.name?.trim() || "?", seconds: 0, running: false };
    person.seconds += seconds;
    if (!e.ended_at) person.running = true;
    if (e.name?.trim()) person.name = e.name.trim();
    byUser.set(key, person);
  }
  const people = [...byUser.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
  return {
    totalSeconds: people.reduce((sum, p) => sum + p.seconds, 0),
    people,
    running: people.some((p) => p.running),
  };
}

/** 4500 -> "01:15:00" (hours are not capped: 100h -> "100:00:00"). */
export function formatClockSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
