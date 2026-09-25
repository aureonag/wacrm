import { describe, expect, it } from "vitest";
import { extractScopeSections } from "./scope";

const MARKDOWN = `# TERMO DE ACEITE

## CONTRATANTE
**Razão Social:** ACME LTDA

---

# SERVIÇO CONTRATADO
### Gestão de Tráfego Pago
Campanhas de captação de leads.

---

# O QUE ESTÁ INCLUSO
- Criação das campanhas
- Relatório mensal

---

# VALOR DA CONTRATAÇÃO
### R$ 500,00 por mês

---

# RESPONSABILIDADES DA CONTRATANTE
- Fornecer acessos
- Aprovar peças em 48h

---

# RESPONSABILIDADES DA AUREON
- Otimizar campanhas

---

# ACEITE
`;

const PLAIN = `TERMO DE ACEITE SOCIAL MEDIA

SERVIÇO CONTRATADO
Gestão de Social Media

O QUE ESTÁ INCLUSO
- 12 posts por mês

INVESTIMENTO
R$ 1.200,00 por mês

RESPONSABILIDADES DA CONTRATANTE
- Enviar materiais
`;

describe("extractScopeSections", () => {
  it("keeps only the four scope sections from a markdown contract", () => {
    const keys = extractScopeSections(MARKDOWN).map((s) => s.key);
    expect(keys).toEqual(["service", "included", "clientDuties", "aureonDuties"]);
  });

  it("keeps nested sub-headings inside their section", () => {
    const service = extractScopeSections(MARKDOWN).find((s) => s.key === "service");
    expect(service?.lines).toEqual(["Gestão de Tráfego Pago", "Campanhas de captação de leads."]);
  });

  it("never returns the price section or its numbers", () => {
    const all = JSON.stringify(extractScopeSections(MARKDOWN));
    expect(all).not.toMatch(/R\$/);
    expect(all).not.toMatch(/500/);
  });

  it("works on plain-text (all-caps heading) contracts and tolerates a missing section", () => {
    const sections = extractScopeSections(PLAIN);
    expect(sections.map((s) => s.key)).toEqual(["service", "included", "clientDuties"]);
    expect(JSON.stringify(sections)).not.toMatch(/R\$/);
  });

  it("drops a price line even when it sits inside an allowed section", () => {
    const text = "# O QUE ESTÁ INCLUSO\n- Gestão de mídia\n- Verba de R$ 5.000,00 por mês\n\n# ACEITE\n";
    const included = extractScopeSections(text).find((s) => s.key === "included");
    expect(included?.lines).toEqual(["- Gestão de mídia"]);
  });

  it("returns nothing for empty input", () => {
    expect(extractScopeSections(null)).toEqual([]);
    expect(extractScopeSections("")).toEqual([]);
  });
});
