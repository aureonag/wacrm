// Members of a task. A task keeps its main person in `tasks.assignee_id` (what
// the board filters, notifications and reports already read) and the other
// people in `task_participants`. For the screens that is ONE list, "Membros":
// the first member is the assignee, the rest are participants.

export interface TaskMember {
  /** profiles.id */
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface ProfileLike {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

/** Assignee first, then participants, without repeats. */
export function composeMembers(
  assignee: ProfileLike | null | undefined,
  participants: ProfileLike[],
): TaskMember[] {
  const out: TaskMember[] = [];
  const seen = new Set<string>();
  for (const p of [assignee, ...participants]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.full_name?.trim() || "?", avatarUrl: p.avatar_url ?? null });
  }
  return out;
}

/** What to store for a list of member ids: the first is the assignee, the rest participants. */
export function splitMembers(ids: string[]): { assigneeId: string | null; participantIds: string[] } {
  const unique = [...new Set(ids.filter(Boolean))];
  return { assigneeId: unique[0] ?? null, participantIds: unique.slice(1) };
}

/** Does this task involve the person (assignee or participant)? */
export function isTaskMember(task: { assignee_id?: string | null; members?: TaskMember[] }, profileId: string | null): boolean {
  if (!profileId) return false;
  if (task.assignee_id === profileId) return true;
  return (task.members ?? []).some((m) => m.id === profileId);
}

/** Two-letter initials for the avatar fallback. */
export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
