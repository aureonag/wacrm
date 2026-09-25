import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  formatBrDate,
  terminationEmailHtml,
  terminationEmailSubject,
  terminationEmailText,
  type TerminationEmailArgs,
} from "./email-templates";

const args: TerminationEmailArgs = {
  razaoSocial: "ACME Comércio LTDA",
  cnpj: "12.345.678/0001-90",
  representante: "Maria Souza",
  signedAt: "2026-03-10T14:20:00.000Z",
  serviceLines: ["Gestão de Tráfego Pago"],
  effectiveDate: "2026-11-15",
  note: "Cliente encerrou a operação.",
  contractRef: "aef8488d",
};

describe("termination email", () => {
  it("identifies the contract and states the effective date", () => {
    const text = terminationEmailText(args);
    expect(text).toContain("ACME Comércio LTDA");
    expect(text).toContain("12.345.678/0001-90");
    expect(text).toContain("assinado em 10/03/2026");
    expect(text).toContain("DATA DO CANCELAMENTO: 15/11/2026");
    expect(text).toContain("AVISO PRÉVIO: 30 dias corridos");
    expect(text).toContain("TÉRMINO DO CONTRATO: 15/12/2026");
    expect(terminationEmailHtml(args)).toContain("15/12/2026");
    expect(text).toContain("Gestão de Tráfego Pago");
    expect(text).toContain("Cliente encerrou a operação.");
  });

  it("never carries a monetary amount", () => {
    expect(terminationEmailText(args) + terminationEmailHtml(args)).not.toMatch(/R\$/);
  });

  it("escapes anything typed into the note or the company name", () => {
    const html = terminationEmailHtml({ ...args, razaoSocial: "A <b>&</b> B", note: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &lt;b&gt;&amp;&lt;/b&gt; B");
  });

  it("omits optional parts when they are missing", () => {
    const text = terminationEmailText({ ...args, note: null, signedAt: null, serviceLines: [] });
    expect(text).not.toContain("OBSERVAÇÕES");
    expect(text).not.toContain("Data da assinatura");
    expect(text).not.toContain("Serviço contratado");
  });

  it("adds calendar days across month and year ends", () => {
    expect(addDaysIso("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDaysIso("2028-02-01", 30)).toBe("2028-03-02");
  });

  it("formats dates and the subject", () => {
    expect(formatBrDate("2026-01-05")).toBe("05/01/2026");
    expect(terminationEmailSubject("ACME")).toBe("Comunicado de cancelamento de contrato — ACME");
  });
});
