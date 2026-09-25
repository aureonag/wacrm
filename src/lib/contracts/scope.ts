// ============================================================
// Extracts the delivery scope from a rendered contract for the
// Operacional team. Only four sections are ever exposed — the
// contract also carries price sections (VALOR DA CONTRATAÇÃO,
// PACOTES DE INVESTIMENTO, ...) that must never reach Operacional,
// so this is an allow-list, and any line that still looks like a
// price is dropped as a second safety net.
//
// Templates come in two shapes: markdown ("# SERVIÇO CONTRATADO",
// "### sub", "---") and plain text (an all-caps line is a heading).
// ============================================================

export type ScopeSectionKey = "service" | "included" | "clientDuties" | "aureonDuties";

export interface ScopeSection {
  key: ScopeSectionKey;
  heading: string;
  lines: string[];
}

const SECTION_KEYS: Record<string, ScopeSectionKey> = {
  "servico contratado": "service",
  "o que esta incluso": "included",
  "responsabilidades da contratante": "clientDuties",
  "responsabilidades da aureon": "aureonDuties",
};

const ORDER: ScopeSectionKey[] = ["service", "included", "clientDuties", "aureonDuties"];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkup(line: string): string {
  return line.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function looksLikePrice(line: string): boolean {
  return /R\$\s*\d/i.test(line) || /\d\s*%\s*(sobre|do|da|de)\b/i.test(line);
}

interface HeadingInfo {
  text: string;
  level: number;
}

function asHeading(rawLine: string): HeadingInfo | null {
  const line = rawLine.trim();
  const md = /^(#{1,6})\s+(.+)$/.exec(line);
  if (md) return { text: stripMarkup(md[2]), level: md[1].length };
  if (line && line.length <= 70 && !line.includes(":") && !/^[-*]/.test(line)) {
    if (/[A-ZÀ-Ö]/.test(line) && !/[a-zà-öø-ÿ]/.test(line)) return { text: stripMarkup(line), level: 1 };
  }
  return null;
}

export function extractScopeSections(content: string | null | undefined): ScopeSection[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const found = new Map<ScopeSectionKey, ScopeSection>();

  let current: ScopeSection | null = null;
  let currentLevel = 0;

  for (const raw of lines) {
    const heading = asHeading(raw);
    if (heading) {
      const key = SECTION_KEYS[normalize(heading.text)];
      if (key) {
        current = { key, heading: heading.text, lines: [] };
        currentLevel = heading.level;
        if (!found.has(key)) found.set(key, current);
        continue;
      }
      // A heading at the same or a higher level closes the open section;
      // a deeper one ("### sub") is content that belongs to it.
      if (current && heading.level <= currentLevel) {
        current = null;
        continue;
      }
    }
    if (!current) continue;

    const text = stripMarkup(raw.replace(/^#{1,6}\s+/, ""));
    if (!text || /^-{3,}$/.test(text)) continue;
    if (looksLikePrice(text)) continue;
    current.lines.push(text);
  }

  return ORDER.map((k) => found.get(k)).filter((s): s is ScopeSection => !!s && s.lines.length > 0);
}
