// ============================================================
// Task templates + AI autofill for the "Nova tarefa" dialog.
//
// A template is only a starting point (priority, estimate, briefing
// skeleton and checklist) that the person can edit before creating the
// task. The AI step reuses the account's own key (Agentes de IA) to turn
// a one-line description into a title, a filled briefing and a checklist.
// Nothing monetary is ever part of a template or of the AI prompt.
// ============================================================

import type { JSONContent } from "@tiptap/react";
import type { TaskPriority } from "@/types";

export interface TaskTemplate {
  id: string;
  label: string;
  /** Prefix suggested for the title, e.g. "Post — ". */
  titlePrefix: string;
  priority: TaskPriority;
  estimatedMinutes: number | null;
  /** Section headings of the briefing skeleton, in order. */
  sections: string[];
  checklist: string[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "social-post",
    label: "Post para redes sociais",
    titlePrefix: "Post — ",
    priority: "medium",
    estimatedMinutes: 90,
    sections: ["Objetivo", "Formato e canal", "Texto / legenda", "Referências e materiais", "Prazo e observações"],
    checklist: ["Definir pauta e legenda", "Criar a arte", "Revisar ortografia e identidade visual", "Enviar para aprovação do cliente", "Agendar / publicar"],
  },
  {
    id: "ad-creative",
    label: "Criativo de anúncio",
    titlePrefix: "Criativo — ",
    priority: "medium",
    estimatedMinutes: 120,
    sections: ["Objetivo da campanha", "Público-alvo", "Formatos necessários", "Mensagem e chamada (CTA)", "Referências e materiais"],
    checklist: ["Entender o objetivo com o gestor de tráfego", "Produzir as variações", "Exportar nos formatos pedidos", "Revisar", "Entregar ao gestor de tráfego"],
  },
  {
    id: "video-reels",
    label: "Vídeo / Reels",
    titlePrefix: "Vídeo — ",
    priority: "medium",
    estimatedMinutes: 240,
    sections: ["Objetivo", "Roteiro / ideia", "Duração e formato", "Trilha e referências", "Materiais brutos"],
    checklist: ["Aprovar o roteiro", "Receber ou captar o material", "Editar", "Legendar", "Enviar para aprovação"],
  },
  {
    id: "landing-page",
    label: "Landing page / site",
    titlePrefix: "Página — ",
    priority: "medium",
    estimatedMinutes: 480,
    sections: ["Objetivo da página", "Estrutura e seções", "Conteúdo e textos", "Identidade visual", "Integrações (formulário, pixel, WhatsApp)"],
    checklist: ["Montar a estrutura", "Criar o layout", "Desenvolver", "Testar no celular e no computador", "Publicar e conferir os rastreamentos"],
  },
  {
    id: "monthly-report",
    label: "Relatório mensal",
    titlePrefix: "Relatório — ",
    priority: "low",
    estimatedMinutes: 60,
    sections: ["Período", "Métricas principais", "Destaques e aprendizados", "Próximos passos"],
    checklist: ["Coletar os dados do período", "Montar o relatório", "Revisar", "Enviar ao cliente"],
  },
  {
    id: "adjustment",
    label: "Ajuste / alteração",
    titlePrefix: "Ajuste — ",
    priority: "high",
    estimatedMinutes: 30,
    sections: ["O que precisa mudar", "Onde está o material atual", "Referências", "Prazo"],
    checklist: ["Entender o pedido", "Fazer o ajuste", "Revisar", "Devolver para aprovação"],
  },
];

export function templateById(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}

/** Briefing skeleton as editable text: "## Section" followed by an empty line. */
export function templateBriefingText(t: TaskTemplate): string {
  return t.sections.map((s) => `## ${s}\n`).join("\n");
}

/** Editable text -> TipTap document. Supports "## heading", "- bullet" and plain paragraphs. */
export function textToBriefing(text: string): JSONContent {
  const content: JSONContent[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      content.push({
        type: "bulletList",
        content: list.map((i) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: i }] }],
        })),
      });
    }
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const b = /^[-*•]\s+(.+)$/.exec(line);
    if (h) {
      flush();
      content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h[1] }] });
    } else if (b) {
      list.push(b[1]);
    } else {
      flush();
      content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }
  flush();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function checklistFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

export const AI_DRAFT_SYSTEM_PROMPT = [
  "Você ajuda uma agência de marketing a abrir tarefas para a equipe de Operacional (criação, mídia e social media).",
  "Responda SOMENTE com um JSON válido, sem texto antes ou depois e sem cercas de código, neste formato:",
  '{"title": string, "briefing": string, "checklist": string[]}',
  '- "title": título curto e claro da tarefa, em português.',
  '- "briefing": texto em português usando o modelo de seções informado; cada seção começa com uma linha "## Nome da seção" seguida de frases curtas ou linhas iniciadas por "- ". Preencha só com o que dá para inferir da descrição; onde faltar informação, escreva "A definir".',
  '- "checklist": de 3 a 8 passos práticos, na ordem em que devem acontecer.',
  "Nunca invente valores em dinheiro, preços, prazos ou dados do cliente que não estejam na descrição. Não fale de valores.",
].join("\n");

export function buildAiDraftUserMessage(args: {
  template: TaskTemplate | null;
  description: string;
  clientName?: string | null;
}): string {
  const parts: string[] = [];
  if (args.template) {
    parts.push(`Tipo de tarefa: ${args.template.label}`);
    parts.push(`Seções do briefing: ${args.template.sections.join("; ")}`);
    parts.push(`Passos de referência para o checklist: ${args.template.checklist.join("; ")}`);
  }
  if (args.clientName) parts.push(`Cliente: ${args.clientName}`);
  parts.push(`Descrição do pedido: ${args.description}`);
  return parts.join("\n");
}

export interface AiDraft {
  title: string;
  briefing: string;
  checklist: string[];
}

/** Pulls the JSON object out of the model's reply (tolerates code fences / stray text). */
export function parseAiDraft(raw: string): AiDraft | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const briefing = typeof obj.briefing === "string" ? obj.briefing.trim() : "";
    const checklist = Array.isArray(obj.checklist)
      ? obj.checklist.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean).slice(0, 30)
      : [];
    if (!title && !briefing && checklist.length === 0) return null;
    return { title: title.slice(0, 200), briefing, checklist };
  } catch {
    return null;
  }
}
