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
