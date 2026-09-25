// ============================================================
// Assistente interno de tarefas ("Preencher com o assistente").
//
// Roda inteiro dentro do CRM, sem chave de API e sem serviço externo:
// lê a descrição escrita pela pessoa e monta a sugestão por regras —
// reconhece o tipo de tarefa (modelo), o canal, o prazo e a urgência.
// Só sugere; a pessoa revisa e edita tudo antes de criar a tarefa.
// Nunca inventa dado: o que não aparece na descrição fica "A definir".
// ============================================================

import type { TaskPriority } from "@/types";
import { TASK_TEMPLATES, templateById, type TaskTemplate } from "./templates";

export interface AgentDraft {
  templateId: string;
  title: string;
  briefing: string;
  checklist: string[];
  priority: TaskPriority;
  /** YYYY-MM-DD, only when the text names a date. */
  dueDate: string | null;
  estimatedMinutes: number | null;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Keyword -> template. First match with the highest score wins.
const TEMPLATE_KEYWORDS: Record<string, string[]> = {
  "social-post": ["post", "feed", "story", "stories", "carrossel", "legenda", "publicacao", "postagem", "arte para"],
  "ad-creative": ["criativo", "anuncio", "anuncios", "banner", "campanha", "meta ads", "google ads", "trafego"],
  "video-reels": ["video", "reels", "reel", "tiktok", "shorts", "edicao de video", "roteiro", "youtube"],
  "landing-page": ["landing", "site", "pagina", "hotsite", "wordpress", "formulario"],
  "monthly-report": ["relatorio", "resultado do mes", "metricas", "performance do mes"],
  adjustment: ["ajuste", "ajustar", "alterar", "alteracao", "corrigir", "correcao", "trocar", "revisar", "mudar"],
};

const CHANNELS: [string, string][] = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["google ads", "Google Ads"],
  ["meta ads", "Meta Ads"],
  ["whatsapp", "WhatsApp"],
  ["email", "E-mail"],
  ["stories", "Stories"],
  ["reels", "Reels"],
  ["feed", "Feed"],
];

const URGENT_WORDS = ["urgente", "urgencia", "hoje", "amanha", "o quanto antes", "imediato", "prioridade"];

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Finds the first date the text names: hoje, amanhã, weekday, dd/mm(/aaaa) or "dia N". */
export function findDueDate(text: string, now: Date = new Date()): string | null {
  const t = norm(text);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month - 1, day);
    if (!dm[3] && d < today) d = new Date(year + 1, month - 1, day);
    if (d.getMonth() === month - 1 && d.getDate() === day) return iso(d);
  }
  if (/\bhoje\b/.test(t)) return iso(today);
  if (/\bamanha\b/.test(t)) return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  const wd = /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/.exec(t);
  if (wd) {
    const target = WEEKDAYS[wd[1]];
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff));
  }

  const dia = /\bdia\s+(\d{1,2})\b/.exec(t);
  if (dia) {
    const day = Number(dia[1]);
    if (day >= 1 && day <= 31) {
      let d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      if (d.getDate() === day) return iso(d);
    }
  }
  return null;
}

/** Best template for the text, or the generic "adjustment"/"social-post" fallback. */
export function detectTemplate(text: string): TaskTemplate {
  const t = norm(text);
  let best: { id: string; score: number } | null = null;
  for (const [id, words] of Object.entries(TEMPLATE_KEYWORDS)) {
    const score = words.reduce((s, w) => s + (new RegExp(`\\b${w}\\b`).test(t) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { id, score };
  }
  return templateById(best?.id ?? "social-post") ?? TASK_TEMPLATES[0];
}

export function detectChannels(text: string): string[] {
  const t = norm(text);
  const found: string[] = [];
  for (const [key, label] of CHANNELS) {
    if (new RegExp(`\\b${key}\\b`).test(t) && !found.includes(label)) found.push(label);
  }
  return found;
}

function sentenceCase(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

/** Short title: template prefix + the first clause of the description (max ~70 chars). */
function buildTitle(tpl: TaskTemplate, description: string): string {
  const firstClause = description.split(/[.,\n;!?]/)[0].trim().replace(/^(preciso de|precisamos de|fazer|criar|produzir)\s+/i, "");
  let core = firstClause.length > 70 ? firstClause.slice(0, 70).replace(/\s+\S*$/, "") + "…" : firstClause;
  core = sentenceCase(core);
  return core ? `${tpl.titlePrefix}${core}` : tpl.titlePrefix.trim();
}

/** Which section of the skeleton is the best home for each piece of information. */
function pickSection(tpl: TaskTemplate, candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = tpl.sections.find((s) => norm(s).includes(c));
    if (hit) return hit;
  }
  return null;
}

export function draftTaskFromDescription(
  description: string,
  opts: { templateId?: string | null; clientName?: string | null; now?: Date } = {},
): AgentDraft {
  const text = description.trim();
  const now = opts.now ?? new Date();
  const tpl = (opts.templateId ? templateById(opts.templateId) : undefined) ?? detectTemplate(text);
  const channels = detectChannels(text);
  const dueDate = findDueDate(text, now);
  const t = norm(text);
  const urgent = URGENT_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));

  const sectionText = new Map<string, string[]>();
  const put = (section: string | null, line: string) => {
    if (!section || !line) return;
    sectionText.set(section, [...(sectionText.get(section) ?? []), line]);
  };

  put(tpl.sections[0], sentenceCase(text));
  if (opts.clientName) put(tpl.sections[0], `Cliente: ${opts.clientName}`);
  if (channels.length) {
    put(pickSection(tpl, ["canal", "formato", "integr"]) ?? tpl.sections[0], `Canal / formato: ${channels.join(", ")}`);
  }
  if (dueDate) {
    const [y, m, d] = dueDate.split("-");
    put(pickSection(tpl, ["prazo"]) ?? tpl.sections[tpl.sections.length - 1], `Entrega até ${d}/${m}/${y}`);
  }

  const briefing = tpl.sections
    .map((s) => {
      const lines = sectionText.get(s);
      if (!lines?.length) return `## ${s}\nA definir`;
      return `## ${s}\n${lines.map((l) => `- ${l}`).join("\n")}`;
    })
    .join("\n\n");

  const checklist = [...tpl.checklist];
  const extra: [RegExp, string][] = [
    [/\b(foto|fotos|imagem|imagens|logo|logotipo)\b/, "Receber as fotos e a logo do cliente"],
    [/\bwhatsapp\b/, "Conferir o link / número de WhatsApp da chamada"],
    [/\b(promocao|oferta|desconto)\b/, "Confirmar com o cliente as condições da promoção"],
    [/\b(pixel|rastreamento|tag)\b/, "Conferir os rastreamentos e pixels"],
    [/\b(legenda|texto|copy)\b/, "Revisar o texto e a ortografia"],
  ];
  for (const [re, item] of extra) {
    if (re.test(t) && !checklist.includes(item)) {
      // Keep the last step of the template (delivery / publish) at the end.
      checklist.splice(Math.max(1, checklist.length - 1), 0, item);
    }
  }

  return {
    templateId: tpl.id,
    title: buildTitle(tpl, text),
    briefing,
    checklist: checklist.slice(0, 12),
    priority: urgent ? "high" : tpl.priority,
    dueDate,
    estimatedMinutes: tpl.estimatedMinutes,
  };
}
