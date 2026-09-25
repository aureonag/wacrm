import { describe, expect, it } from "vitest";
import { detectChannels, detectTemplate, draftTaskFromDescription, findDueDate } from "./internal-agent";

// Friday 25/09/2026
const NOW = new Date(2026, 8, 25, 10, 0);

describe("detectTemplate", () => {
  it("recognizes each kind of task", () => {
    expect(detectTemplate("Post de Dia das Mães para o Instagram").id).toBe("social-post");
    expect(detectTemplate("Criativo de anúncio para a campanha de Meta Ads").id).toBe("ad-creative");
    expect(detectTemplate("Editar um vídeo em Reels").id).toBe("video-reels");
    expect(detectTemplate("Nova landing page com formulário").id).toBe("landing-page");
    expect(detectTemplate("Relatório do mês de setembro").id).toBe("monthly-report");
    expect(detectTemplate("Corrigir o telefone na arte").id).toBe("adjustment");
  });
  it("falls back to a post when nothing matches", () => {
    expect(detectTemplate("qualquer coisa").id).toBe("social-post");
  });
});

describe("findDueDate", () => {
  it("understands hoje, amanhã and weekdays", () => {
    expect(findDueDate("é para hoje", NOW)).toBe("2026-09-25");
    expect(findDueDate("entregar amanhã", NOW)).toBe("2026-09-26");
    expect(findDueDate("até segunda-feira", NOW)).toBe("2026-09-28");
    expect(findDueDate("até sexta", NOW)).toBe("2026-10-02"); // today is already Friday: next one
  });
  it("understands dd/mm and dia N", () => {
    expect(findDueDate("prazo 30/09", NOW)).toBe("2026-09-30");
    expect(findDueDate("prazo 10/01", NOW)).toBe("2027-01-10"); // already passed this year
    expect(findDueDate("entregar dia 28", NOW)).toBe("2026-09-28");
    expect(findDueDate("prazo 15/03/2027", NOW)).toBe("2027-03-15");
  });
  it("returns null when there is no date", () => {
    expect(findDueDate("post bonito", NOW)).toBeNull();
    expect(findDueDate("31/02", NOW)).toBeNull();
  });
});

describe("detectChannels", () => {
  it("finds channels once each", () => {
    expect(detectChannels("Instagram e instagram, também Stories e WhatsApp")).toEqual(["Instagram", "WhatsApp", "Stories"]);
  });
});

describe("draftTaskFromDescription", () => {
  const draft = draftTaskFromDescription(
    "Post de Dia das Mães para o Instagram, com fotos do produto e chamada para o WhatsApp. Urgente, entregar dia 28",
    { clientName: "Loja X", now: NOW },
  );

  it("picks the template, title, priority and due date", () => {
    expect(draft.templateId).toBe("social-post");
    expect(draft.title.startsWith("Post — ")).toBe(true);
    expect(draft.priority).toBe("high");
    expect(draft.dueDate).toBe("2026-09-28");
  });

  it("fills the briefing skeleton and leaves the rest as 'A definir'", () => {
    expect(draft.briefing).toContain("## Objetivo");
    expect(draft.briefing).toContain("Cliente: Loja X");
    expect(draft.briefing).toContain("Canal / formato: Instagram, WhatsApp");
    expect(draft.briefing).toContain("Entrega até 28/09/2026");
    expect(draft.briefing).toContain("## Referências e materiais\nA definir");
  });

  it("adds extra checklist steps but keeps the delivery step last", () => {
    expect(draft.checklist).toContain("Receber as fotos e a logo do cliente");
    expect(draft.checklist).toContain("Conferir o link / número de WhatsApp da chamada");
    expect(draft.checklist[draft.checklist.length - 1]).toBe("Agendar / publicar");
  });

  it("respects a template chosen by the person and never mentions money", () => {
    const d = draftTaskFromDescription("preciso de algo para o cliente", { templateId: "monthly-report", now: NOW });
    expect(d.templateId).toBe("monthly-report");
    expect(JSON.stringify(d)).not.toMatch(/R\$/);
  });
});
