// ============================================================
// Contrato: turns a plain-text rendered contract into structured
// sections for visual display (see contract-document.tsx).
//
// Templates stay plain text with blank-line paragraphs (see
// templating.ts's rationale — v1 avoids rich HTML so a future
// PDF renderer doesn't have to map arbitrary markup). This module
// leans on a convention the user's own real templates already
// follow without being told to: a short, colon-free, all-caps
// line acts as a section heading. No template authoring change
// is required — this only affects how already-existing plain
// text gets displayed.
// ============================================================

export type ContractSectionTone = "info" | "warning" | "default";

export type ContractSectionBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] };

export interface ContractSection {
  heading: string;
  tone: ContractSectionTone;
  blocks: ContractSectionBlock[];
}

export interface ParsedContract {
  title: string | null;
  intro: string[][];
  sections: ContractSection[];
}

const SMALL_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "em", "com", "para", "ao", "aos", "às", "à", "ou",
]);

/** "PRAZO DA CONTRATAÇÃO" → "Prazo da Contratação" — matches the reference UI's title-case section headers. */
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (!word) return word;
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 70) return false;
  if (trimmed.includes(":")) return false;
  if (trimmed.startsWith("-") || trimmed.startsWith("*")) return false;
  if (!/[A-ZÀ-Ö]/.test(trimmed)) return false;
  if (/[a-zà-öø-ÿ]/.test(trimmed)) return false;
  return true;
}

function toneFor(heading: string): ContractSectionTone {
  const upper = heading.toUpperCase();
  if (/INVESTIMENTO|COBRANÇA|PAGAMENTO/.test(upper)) return "info";
  if (/RESCIS|CANCELAMENTO/.test(upper)) return "warning";
  return "default";
}

function isListBlock(lines: string[]): boolean {
  return lines.length > 0 && lines.every((line) => line.startsWith("-") || line.startsWith("*"));
}

function makeBlock(lines: string[]): ContractSectionBlock {
  if (isListBlock(lines)) {
    return { type: "list", items: lines.map((line) => line.replace(/^[-*]\s*/, "")) };
  }
  return { type: "paragraph", lines };
}

export function parseContractSections(content: string): ParsedContract {
  const rawBlocks = content
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((block) => block.length > 0);

  let title: string | null = null;
  let startIndex = 0;
  if (rawBlocks.length > 0 && rawBlocks[0].length === 1 && isHeadingLine(rawBlocks[0][0])) {
    title = rawBlocks[0][0];
    startIndex = 1;
  }

  const intro: string[][] = [];
  const sections: ContractSection[] = [];
  let current: ContractSection | null = null;

  for (let i = startIndex; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];
    if (isHeadingLine(block[0])) {
      if (current) sections.push(current);
      const heading = block[0];
      const rest = block.slice(1);
      current = { heading, tone: toneFor(heading), blocks: rest.length ? [makeBlock(rest)] : [] };
    } else if (current) {
      current.blocks.push(makeBlock(block));
    } else {
      intro.push(block);
    }
  }
  if (current) sections.push(current);

  return { title, intro, sections };
}
