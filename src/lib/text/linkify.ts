// ============================================================
// linkify — pure, testable splitter for turning URLs typed/pasted
// into free text (deal comments, task comments, briefings, ...) into
// clickable pieces. No HTML string building here (XSS surface); callers
// map the parts to React nodes.
// ============================================================

export interface LinkifyPart {
  text: string;
  /** Set only for a piece that is a URL. */
  href?: string;
}

// http(s):// or www. — the common cases people actually paste. Trailing
// punctuation that's almost always sentence punctuation, not part of the
// URL (.,;:!?) and a lone closing bracket, are trimmed off the match.
const URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

/** Splits `text` into plain and link parts, preserving order and content. */
export function linkifyText(text: string): LinkifyPart[] {
  const parts: LinkifyPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    let end = start + raw.length;

    const trailing = TRAILING_PUNCT_RE.exec(raw);
    if (trailing) {
      // Only trim a closing bracket if there's no matching opener inside the URL.
      const trimmable = trailing[0].replace(/\)/g, (b) => (raw.includes("(") ? "" : b)).replace(/\]/g, (b) => (raw.includes("[") ? "" : b));
      if (trimmable) {
        raw = raw.slice(0, raw.length - trimmable.length);
        end -= trimmable.length;
      }
    }

    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start) });
    parts.push({ text: raw, href: raw.startsWith("www.") ? `https://${raw}` : raw });
    lastIndex = end;
  }

  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  return parts;
}
