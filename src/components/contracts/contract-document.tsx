"use client";

// ============================================================
// Renders a contract's plain-text rendered_content as a structured,
// visual document — section cards with title-cased headings, tinted
// backgrounds for billing/cancellation clauses, and bolded figures
// (currency, percentages, day/month counts). See render-sections.ts
// for the parsing convention this relies on.
//
// Two display themes:
//  - "app" (default): follows the CRM's dark design tokens — used for
//    the agent-side live preview inside the dashboard.
//  - "paper": a literal light/white document look, independent of the
//    viewer's theme — used on the public signing page, where the
//    client expects something that reads like an actual paper
//    contract regardless of dark mode. Deliberately hardcoded colors,
//    not theme tokens.
// ============================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  parseContractSections,
  toTitleCase,
  type ContractSectionTone,
} from "@/lib/contracts/render-sections";

type DocumentTheme = "app" | "paper";

const PARTY_HEADINGS = new Set(["contratante", "contratada"]);

interface ThemeClasses {
  title: string;
  intro: string;
  toneCard: Record<ContractSectionTone, string>;
  toneHeading: Record<ContractSectionTone, string>;
  body: string;
  strong: string;
  link: string;
  summaryCard: string;
  summaryLabel: string;
  summaryLabelHighlight: string;
  summaryValue: string;
  summaryValueHighlight: string;
  summaryDivider: string;
}

const THEMES: Record<DocumentTheme, ThemeClasses> = {
  app: {
    title: "text-foreground",
    intro: "text-muted-foreground",
    toneCard: {
      info: "border-blue-500/30 bg-blue-500/10",
      warning: "border-amber-500/30 bg-amber-500/10",
      default: "border-border bg-muted/30",
    },
    toneHeading: {
      info: "text-blue-200",
      warning: "text-amber-200",
      default: "text-foreground",
    },
    body: "text-foreground/90",
    strong: "font-semibold text-foreground",
    link: "text-primary underline underline-offset-2",
    summaryCard: "border-border bg-card",
    summaryLabel: "text-muted-foreground",
    summaryLabelHighlight: "font-semibold text-foreground",
    summaryValue: "text-foreground",
    summaryValueHighlight: "font-semibold text-emerald-400",
    summaryDivider: "divide-border/60",
  },
  paper: {
    title: "text-neutral-900",
    intro: "text-neutral-500",
    toneCard: {
      info: "border-blue-200 bg-blue-50",
      warning: "border-amber-200 bg-amber-50",
      default: "border-neutral-200 bg-white",
    },
    toneHeading: {
      info: "text-blue-900",
      warning: "text-amber-900",
      default: "text-neutral-900",
    },
    body: "text-neutral-700",
    strong: "font-semibold text-neutral-900",
    link: "text-blue-700 underline underline-offset-2",
    summaryCard: "border-neutral-200 bg-white",
    summaryLabel: "text-neutral-500",
    summaryLabelHighlight: "font-semibold text-neutral-900",
    summaryValue: "text-neutral-900",
    summaryValueHighlight: "font-semibold text-emerald-600",
    summaryDivider: "divide-neutral-200",
  },
};

interface SummaryRow {
  label: string;
  value: string;
}

/** "RESUMO DA CONTRATAÇÃO" (or similarly named) sections render as a
 *  label/value table instead of a generic card — only when every line
 *  in the section cleanly splits into "Label: Value", so anything
 *  written more freely still falls back to the normal card. */
function parseSummaryRows(section: {
  heading: string;
  blocks: { type: "paragraph" | "list"; lines?: string[] }[];
}): SummaryRow[] | null {
  if (!/RESUMO/i.test(section.heading)) return null;
  const lines = section.blocks.flatMap((b) => (b.type === "paragraph" ? (b.lines ?? []) : []));
  if (lines.length === 0) return null;
  const rows: SummaryRow[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    rows.push({ label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return rows;
}

function isHighlightRow(label: string): boolean {
  return /investimento|total/i.test(label);
}

const TOKEN_REGEX =
  /(https?:\/\/\S+)|(R\$\s?[\d.,]+)|(\d+%)|(\d+\s*(?:\([^)]*\))?\s*(?:dias\s*úteis|dias?|meses|mês|anos?))/gi;

function renderWithFigures(text: string, t: ThemeClasses): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const regex = new RegExp(TOKEN_REGEX.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      parts.push(
        <a key={key++} href={match[1]} target="_blank" rel="noreferrer" className={t.link}>
          {match[1]}
        </a>,
      );
    } else {
      parts.push(
        <strong key={key++} className={t.strong}>
          {match[0]}
        </strong>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}

interface ContractDocumentProps {
  content: string;
  /** Skip CONTRATANTE/CONTRATADA sections — used on the public page, which shows that data as structured cards above instead. */
  hideParties?: boolean;
  /** "paper" renders a fixed light/white document look regardless of the viewer's theme. Defaults to "app" (follows CRM dark tokens). */
  theme?: DocumentTheme;
  className?: string;
}

export function ContractDocument({
  content,
  hideParties = false,
  theme = "app",
  className,
}: ContractDocumentProps) {
  const parsed = parseContractSections(content);
  const sections = hideParties
    ? parsed.sections.filter((s) => !PARTY_HEADINGS.has(s.heading.trim().toLowerCase()))
    : parsed.sections;
  const t = THEMES[theme];

  return (
    <div className={cn("space-y-4", className)}>
      {parsed.title && (
        <h2 className={cn("text-balance text-center text-lg font-semibold", t.title)}>
          {toTitleCase(parsed.title)}
        </h2>
      )}
      {parsed.intro.length > 0 && (
        <div className={cn("space-y-1.5 text-center text-sm", t.intro)}>
          {parsed.intro.map((block, i) => (
            <p key={i}>{block.join(" ")}</p>
          ))}
        </div>
      )}

      {sections.map((section, i) => {
        const summaryRows = parseSummaryRows(section);
        if (summaryRows) {
          return (
            <div key={i} className={cn("space-y-1 rounded-lg border p-4", t.summaryCard)}>
              <h3 className={cn("mb-1 text-sm font-semibold", t.title)}>{toTitleCase(section.heading)}</h3>
              <div className={cn("divide-y", t.summaryDivider)}>
                {summaryRows.map((row, k) => {
                  const highlight = isHighlightRow(row.label);
                  return (
                    <div key={k} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className={highlight ? t.summaryLabelHighlight : t.summaryLabel}>{row.label}</span>
                      <span className={cn("text-right tabular-nums", highlight ? t.summaryValueHighlight : t.summaryValue)}>
                        {row.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={i} className={cn("space-y-2 rounded-lg border p-4", t.toneCard[section.tone])}>
            <h3 className={cn("text-sm font-semibold", t.toneHeading[section.tone])}>
              {toTitleCase(section.heading)}
            </h3>
            {section.blocks.map((block, j) =>
              block.type === "list" ? (
                <ul key={j} className={cn("list-disc space-y-1 pl-5 text-sm", t.body)}>
                  {block.items.map((item, k) => (
                    <li key={k}>{renderWithFigures(item, t)}</li>
                  ))}
                </ul>
              ) : (
                <div key={j} className={cn("space-y-1 text-sm", t.body)}>
                  {block.lines.map((line, k) => (
                    <p key={k}>{renderWithFigures(line, t)}</p>
                  ))}
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
