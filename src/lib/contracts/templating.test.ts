import { describe, expect, it } from "vitest";
import { renderTemplate } from "./templating";

describe("renderTemplate", () => {
  it("replaces every known placeholder", () => {
    const out = renderTemplate("Olá {{nome}}, CNPJ {{cnpj}}.", {
      nome: "Empresa X",
      cnpj: "00.000.000/0001-00",
    });
    expect(out).toBe("Olá Empresa X, CNPJ 00.000.000/0001-00.");
  });

  it("leaves an unknown placeholder untouched instead of blanking it", () => {
    const out = renderTemplate("Valor: {{valor_desconhecido}}", {});
    expect(out).toBe("Valor: {{valor_desconhecido}}");
  });

  it("tolerates stray whitespace inside the braces", () => {
    const out = renderTemplate("{{  nome  }}", { nome: "Ok" });
    expect(out).toBe("Ok");
  });

  it("replaces every occurrence of a repeated placeholder", () => {
    const out = renderTemplate("{{nome}} e {{nome}} de novo", { nome: "A" });
    expect(out).toBe("A e A de novo");
  });
});
