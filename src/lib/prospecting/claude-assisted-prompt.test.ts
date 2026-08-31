import { describe, expect, it } from "vitest";
import { buildClaudeResearchPrompt } from "./claude-assisted-prompt";
import { PROSPECTING_TEMPLATE_COLUMNS } from "./external-import";

describe("buildClaudeResearchPrompt", () => {
  it("uses the Lead Generation checklist and fills in niche/region for that frente", () => {
    const prompt = buildClaudeResearchPrompt({
      frente: "leadgen",
      niche: "clínicas odontológicas",
      region: "Santo André",
      quantity: 20,
    });
    expect(prompt).toContain("clínicas odontológicas");
    expect(prompt).toContain("Santo André");
    expect(prompt).toContain("INSTAGRAM");
    expect(prompt).toContain("CONVERSÃO");
    expect(prompt).not.toContain("PRODUTO E OPERAÇÃO");
  });

  it("uses the AVR checklist for the e-commerce frente", () => {
    const prompt = buildClaudeResearchPrompt({ frente: "avr", niche: "moda feminina", quantity: 10 });
    expect(prompt).toContain("PRODUTO E OPERAÇÃO");
    expect(prompt).toContain("Atraia/Venda/Retenha");
    expect(prompt).not.toContain("INTENÇÃO DE CRESCIMENTO");
  });

  it("lists every template column so the output format matches what the app can parse back", () => {
    const prompt = buildClaudeResearchPrompt({ frente: "leadgen", quantity: 5 });
    for (const col of PROSPECTING_TEMPLATE_COLUMNS) {
      expect(prompt).toContain(col.header);
    }
  });

  it("never asks the model to invent data", () => {
    const prompt = buildClaudeResearchPrompt({ frente: "avr", quantity: 5 });
    expect(prompt.toLowerCase()).toContain("nunca invente");
  });
});
