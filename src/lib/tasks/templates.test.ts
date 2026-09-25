import { describe, expect, it } from "vitest";
import {
  TASK_TEMPLATES,
  buildAiDraftUserMessage,
  checklistFromText,
  parseAiDraft,
  templateBriefingText,
  textToBriefing,
} from "./templates";

describe("templates", () => {
  it("have unique ids and never mention money", () => {
    const ids = TASK_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(TASK_TEMPLATES)).not.toMatch(/R\$|valor|preço/i);
  });

  it("builds an editable skeleton with one heading per section", () => {
    const t = TASK_TEMPLATES[0];
    const text = templateBriefingText(t);
    for (const s of t.sections) expect(text).toContain(`## ${s}`);
  });
});

describe("textToBriefing", () => {
  it("maps headings, bullets and paragraphs", () => {
    const doc = textToBriefing("## Objetivo\nDivulgar a promoção\n\n- item 1\n- item 2\n\nfim");
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "paragraph"]);
    expect(doc.content?.[2].content).toHaveLength(2);
  });
  it("never returns an empty document", () => {
    expect(textToBriefing("   ").content).toHaveLength(1);
  });
});

describe("checklistFromText", () => {
  it("strips bullets and numbering and drops empty lines", () => {
    expect(checklistFromText("- um\n2) dois\n\n  três ")).toEqual(["um", "dois", "três"]);
  });
});

describe("parseAiDraft", () => {
  it("parses plain and fenced JSON", () => {
    const raw = '```json\n{"title":"Post da Páscoa","briefing":"## Objetivo\\nX","checklist":["a","b"]}\n```';
    expect(parseAiDraft(raw)).toEqual({ title: "Post da Páscoa", briefing: "## Objetivo\nX", checklist: ["a", "b"] });
  });
  it("returns null for garbage or empty objects", () => {
    expect(parseAiDraft("não sei")).toBeNull();
    expect(parseAiDraft("{}")).toBeNull();
    expect(parseAiDraft("{oops")).toBeNull();
  });
  it("ignores non-string checklist entries", () => {
    expect(parseAiDraft('{"title":"t","checklist":["a",1,null,"b"]}')?.checklist).toEqual(["a", "b"]);
  });
});

describe("buildAiDraftUserMessage", () => {
  it("includes the template, client and description", () => {
    const msg = buildAiDraftUserMessage({ template: TASK_TEMPLATES[0], description: "post do dia das mães", clientName: "Loja X" });
    expect(msg).toContain("Post para redes sociais");
    expect(msg).toContain("Cliente: Loja X");
    expect(msg).toContain("post do dia das mães");
  });
});
