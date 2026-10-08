// Which notifications become a pop-up on the person's desktop. The choice is
// personal and per browser (the permission to show pop-ups is per browser
// too), so it is kept in localStorage — no database involved.

import type { Notification, NotificationType } from "@/types";

/** Tipos agrupados como aparecem na tela de escolha. */
export const NOTIFICATION_GROUPS: { key: string; types: NotificationType[] }[] = [
  { key: "mine", types: ["task_mention", "task_assigned", "task_reassigned", "task_participant_added", "task_comment", "comment_reply"] },
  { key: "status", types: ["task_moved", "task_transferred", "task_completed", "task_reopened", "task_urgent", "task_updated", "task_file_added"] },
  { key: "dates", types: ["due_date_set", "due_date_changed", "due_date_approaching", "task_overdue"] },
  { key: "subtasks", types: ["subtask_created", "subtask_completed", "approval_requested", "approval_approved", "approval_rejected"] },
  { key: "business", types: ["contract_signed", "deal_won", "kickoff_task_created", "conversation_assigned"] },
];

/** On from the start: what asks for the person's attention. The rest is only in the bell. */
export const DEFAULT_DESKTOP_TYPES: NotificationType[] = [
  "task_mention",
  "task_assigned",
  "task_reassigned",
  "task_participant_added",
  "task_comment",
  "comment_reply",
  "task_urgent",
  "task_overdue",
  "due_date_approaching",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "contract_signed",
  "deal_won",
  "kickoff_task_created",
  "conversation_assigned",
];

export interface DesktopPrefs {
  /** Master switch for the pop-ups of this browser. */
  enabled: boolean;
  /** Only the types the person changed from the default. */
  overrides: Partial<Record<NotificationType, boolean>>;
  /** Also show the system pop-up when the CRM is the window in front (default: only a toast inside the CRM). */
  alwaysSystem?: boolean;
}

export const DEFAULT_PREFS: DesktopPrefs = { enabled: true, overrides: {} };

export function isTypeEnabled(prefs: DesktopPrefs, type: NotificationType): boolean {
  if (!prefs.enabled) return false;
  const override = prefs.overrides[type];
  return override ?? DEFAULT_DESKTOP_TYPES.includes(type);
}

/** Type switch as shown in the settings (the master switch aside). */
export function typeChecked(prefs: DesktopPrefs, type: NotificationType): boolean {
  return prefs.overrides[type] ?? DEFAULT_DESKTOP_TYPES.includes(type);
}

const storageKey = (userId: string) => `wacrm:desktop-notifications:${userId}`;

export function readPrefs(userId: string): DesktopPrefs {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    return {
      enabled: parsed.enabled !== false,
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      alwaysSystem: parsed.alwaysSystem === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(userId: string, prefs: DesktopPrefs) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    // Same tab: let the notifier pick the change up right away.
    window.dispatchEvent(new CustomEvent("wacrm:desktop-prefs-changed"));
  } catch {
    // Storage blocked: the choice just is not remembered.
  }
}

/** What the pop-up says: the summary of the notification and, when known, who caused it. */
export function popupBody(n: Pick<Notification, "body">, actorName?: string | null): string {
  const parts = [n.body?.trim(), actorName ? `por ${actorName}` : null].filter(Boolean);
  return parts.join(" · ");
}
