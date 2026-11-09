// Marketing timeline: dated milestones of a client (a campaign started, a new
// creative, a promotion). Pure helpers; the data lives in reportei_timeline_events.

import { isYmd } from "@/lib/reportei/report";

export interface TimelineEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  description: string;
}

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 1000;

export interface TimelineInput {
  date: string;
  title: string;
  description: string;
}

/** A valid event from untrusted input (the form), or null. */
export function parseTimelineInput(input: unknown): TimelineInput | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  if (!isYmd(o.date)) return null;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (title.length < 1 || title.length > TITLE_MAX) return null;
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > DESCRIPTION_MAX) return null;
  return { date: o.date, title, description };
}

interface Row {
  id: string;
  event_date: string;
  title: string;
  description: string | null;
}

export function eventFromRow(row: Row): TimelineEvent {
  return { id: row.id, date: row.event_date, title: row.title, description: row.description ?? "" };
}

/** Events inside the range (both ends included), oldest first. */
export function eventsInRange(events: readonly TimelineEvent[], since: string, until: string): TimelineEvent[] {
  return events.filter((e) => e.date >= since && e.date <= until).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR"));
}
