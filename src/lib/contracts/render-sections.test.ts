import { describe, expect, it } from "vitest";
import { parseContractSections, toTitleCase } from "./render-sections";

describe("toTitleCase", () => {
  it("title-cases an all-caps heading, keeping small words lowercase", () => {
    expect(toTitleCase("PRAZO DA CONTRATAÇÃO")).toBe("Prazo da Contratação");
    expect(toTitleCase("RESCISÃO")).toBe("Rescisão");
  });
});

describe("parseContractSections", () => {
  const content = `TERMO DE ACEITE

Introdução do contrato aqui.

CONTRATANTE
Razão Social: Acme LTDA
CNPJ: 00.000.000/0001-00

INVESTIMENTO
R$ 2.000,00 por mês

O pagamento ocorre mensalmente.

RESCISÃO
Aviso prévio de 30 dias.

- item um da lista;
- item dois da lista.`;

  it("extracts the document title and intro paragraphs", () => {
    const parsed = parseContractSections(content);
    expect(parsed.title).toBe("TERMO DE ACEITE");
    expect(parsed.intro).toEqual([["Introdução do contrato aqui."]]);
  });

  it("groups a heading with its immediate body into one section", () => {
    const parsed = parseContractSections(content);
    const contratante = parsed.sections.find((s) => s.heading === "CONTRATANTE");
    expect(contratante?.blocks).toEqual([
      { type: "paragraph", lines: ["Razão Social: Acme LTDA", "CNPJ: 00.000.000/0001-00"] },
    ]);
  });

  it("keeps appending later blocks without a new heading to the current section", () => {
    const parsed = parseContractSections(content);
    const investimento = parsed.sections.find((s) => s.heading === "INVESTIMENTO");
    expect(investimento?.blocks).toEqual([
      { type: "paragraph", lines: ["R$ 2.000,00 por mês"] },
      { type: "paragraph", lines: ["O pagamento ocorre mensalmente."] },
    ]);
  });

  it("detects a bullet block appended to a section as a list", () => {
    const parsed = parseContractSections(content);
    const rescisao = parsed.sections.find((s) => s.heading === "RESCISÃO");
    expect(rescisao?.blocks).toEqual([
      { type: "paragraph", lines: ["Aviso prévio de 30 dias."] },
      { type: "list", items: ["item um da lista;", "item dois da lista."] },
    ]);
  });

  it("assigns info/warning tones based on the heading keyword", () => {
    const parsed = parseContractSections(content);
    expect(parsed.sections.find((s) => s.heading === "INVESTIMENTO")?.tone).toBe("info");
    expect(parsed.sections.find((s) => s.heading === "RESCISÃO")?.tone).toBe("warning");
    expect(parsed.sections.find((s) => s.heading === "CONTRATANTE")?.tone).toBe("default");
  });
});
