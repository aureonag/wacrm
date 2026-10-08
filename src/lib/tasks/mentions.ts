// @mentions in task comments. Pure helpers shared by the comment box
// (autocomplete), the submit (who was mentioned) and the thread (highlighting).

export interface MentionMember {
  /** profiles.id — what task_comment_mentions stores. */
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Lower case, no accents: "Mídia" and "midia" are the same for matching. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ActiveMention {
  /** Index of the "@" in the text. */
  start: number;
  query: string;
  matches: MentionMember[];
}

/**
 * The "@something" being typed right before the caret, with the people it
 * could be. Null when the caret is not in a mention (an "@" inside an e-mail
 * or a word does not count) or nobody matches. A match is a name (or any word
 * of it) that starts with what was typed, so "@fel" and "@cordeiro" both find
 * "Felipe Cordeiro Queiroz". Everyone who matches is offered (the list scrolls);
 * `limit` is only a safety cap.
 */
export function activeMention(text: string, caret: number, members: MentionMember[], limit = 100): ActiveMention | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 40) return null;
  const q = fold(query);
  const matches = members.filter((m) => ` ${fold(m.name)}`.includes(` ${q}`)).slice(0, limit);
  if (matches.length === 0) return null;
  return { start: at, query, matches };
}

/** Text with the "@query" before the caret replaced by "@Name " and the new caret position. */
export function insertMention(text: string, caret: number, mention: ActiveMention, member: MentionMember) {
  const inserted = `@${member.name} `;
  const next = text.slice(0, mention.start) + inserted + text.slice(caret);
  return { text: next, caret: mention.start + inserted.length };
}

/** Ids of the people whose "@Name" is in the text (checked again at send time, so deleted mentions do not notify). */
export function extractMentionedIds(text: string, members: MentionMember[]): string[] {
  const folded = fold(text);
  const ids: string[] = [];
  for (const m of members) {
    const re = new RegExp(`(^|\\s)@${escapeRegExp(fold(m.name))}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(folded)) ids.push(m.id);
  }
  return ids;
}

export interface MentionPart {
  text: string;
  mention?: MentionMember;
}

/** Splits a comment into plain text and mention pieces, to highlight the "@Name"s. */
export function splitMentions(text: string, members: MentionMember[]): MentionPart[] {
  if (members.length === 0 || !text.includes("@")) return [{ text }];
  const names = [...members].sort((a, b) => b.name.length - a.name.length);
  const byName = new Map(names.map((m) => [m.name.toLowerCase(), m]));
  const re = new RegExp(`(?<![^\\s])@(${names.map((m) => escapeRegExp(m.name)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ text: match[0], mention: byName.get(match[1].toLowerCase()) });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length > 0 ? parts : [{ text }];
}
