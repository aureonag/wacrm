// ============================================================
// Builds the Operacional kickoff task briefing (TipTap JSON) from a
// closed deal. By design nothing monetary is ever included: no deal
// value, no contract price — Operacional must not see them.
// ============================================================

import type { JSONContent } from "@tiptap/react";
import type { ScopeSection, ScopeSectionKey } from "@/lib/contracts/scope";

export const KICKOFF_CHECKLIST = [
  "Agendar a reunião de kickoff com o cliente",
  "Revisar contrato e escopo de entrega",
  "Coletar acessos e materiais do cliente",
];

export const SCOPE_TITLES: Record<ScopeSectionKey, string> = {
  service: "Serviço contratado",
  included: "O que está incluso",
  clientDuties: "Responsabilidades do cliente",
  aureonDuties: "Nossas responsabilidades",
};

export interface KickoffBriefingInput {
  contact: { name?: string | null; phone?: string | null; email?: string | null } | null;
  segment?: string | null;
  region?: string | null;
  origin?: string | null;
  scope: ScopeSection[];
  hasSignedContract: boolean;
  /** Names of the signed contracts (their templates), e.g. "Termo de aceite - Tráfego Pago - Lead Generation".
   *  A deal can have more than one (one per front). */
  contractTitles?: string[];
  observations?: string | null;
}

function text(t: string): JSONContent {
  return { type: "text", text: t };
}
function paragraph(t: string): JSONContent {
  return { type: "paragraph", content: [text(t)] };
}
function heading(t: string, level = 2): JSONContent {
  return { type: "heading", attrs: { level }, content: [text(t)] };
}
function bullets(items: string[]): JSONContent {
  return {
    type: "bulletList",
    content: items.map((i) => ({ type: "listItem", content: [paragraph(i)] })),
  };
}

function linesToBlocks(lines: string[]): JSONContent[] {
  const blocks: JSONContent[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(bullets(list));
    list = [];
  };
  for (const line of lines) {
    if (/^[-*•]\s+/.test(line)) {
      list.push(line.replace(/^[-*•]\s+/, ""));
    } else {
      flush();
      blocks.push(paragraph(line));
    }
  }
  flush();
  return blocks;
}

export function buildKickoffBriefing(input: KickoffBriefingInput): JSONContent {
  const content: JSONContent[] = [];

  // First thing the person reads: which contract / front this kickoff is about.
  const titles = (input.contractTitles ?? []).map((t) => t.trim()).filter(Boolean);
  if (titles.length === 1) {
    content.push(heading("Contrato assinado"), paragraph(titles[0]));
  } else if (titles.length > 1) {
    content.push(heading("Contratos assinados"), bullets(titles));
  }

  const clientLines: string[] = [];
  if (input.contact?.name) clientLines.push(`Nome: ${input.contact.name}`);
  if (input.contact?.phone) clientLines.push(`Telefone: ${input.contact.phone}`);
  if (input.contact?.email) clientLines.push(`E-mail: ${input.contact.email}`);
  if (clientLines.length) {
    content.push(heading("Cliente"), bullets(clientLines));
  }

  const dealLines: string[] = [];
  if (input.segment) dealLines.push(`Segmento: ${input.segment}`);
  if (input.region) dealLines.push(`Região: ${input.region}`);
  if (input.origin) dealLines.push(`Origem: ${input.origin}`);
  if (dealLines.length) {
    content.push(heading("Negócio"), bullets(dealLines));
  }

  content.push(heading("Escopo do contrato"));
  if (input.scope.length) {
    for (const section of input.scope) {
      content.push(heading(SCOPE_TITLES[section.key], 3), ...linesToBlocks(section.lines));
    }
  } else {
    content.push(
      paragraph(
        input.hasSignedContract
          ? "Não foi possível extrair o escopo do contrato. Consulte o comercial."
          : "Este negócio não tem contrato assinado vinculado. Consulte o comercial.",
      ),
    );
  }

  const obs = (input.observations ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (obs.length) {
    content.push(heading("Observações do comercial"), ...obs.map(paragraph));
  }

  return { type: "doc", content };
}
