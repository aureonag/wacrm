import { describe, expect, it } from "vitest";
import { buildKickoffBriefing } from "./kickoff-briefing";

const dump = (v: unknown) => JSON.stringify(v);

describe("buildKickoffBriefing", () => {
  it("includes client, scope and the seller's observations", () => {
    const doc = buildKickoffBriefing({
      contact: { name: "Dr Aline Bueno", phone: "11 99999-0000", email: "a@b.com" },
      segment: "Saúde",
      scope: [{ key: "included", heading: "O QUE ESTÁ INCLUSO", lines: ["- Campanhas", "- Relatório"] }],
      hasSignedContract: true,
      observations: "Cliente prefere contato à tarde.\nUsa WhatsApp Business.",
    });
    const s = dump(doc);
    expect(s).toContain("Dr Aline Bueno");
    expect(s).toContain("O que está incluso");
    expect(s).toContain("Campanhas");
    expect(s).toContain("Observações do comercial");
    expect(s).toContain("Usa WhatsApp Business.");
  });

  it("puts the signed contract title(s) first", () => {
    const one = buildKickoffBriefing({
      contact: null,
      scope: [],
      hasSignedContract: true,
      contractTitles: ["Termo de aceite - Tráfego Pago PROMOCIONAL - Lead Generation"],
    });
    expect(one.content?.[0]).toMatchObject({ type: "heading" });
    expect(dump(one.content?.slice(0, 2))).toContain("Contrato assinado");
    expect(dump(one.content?.slice(0, 2))).toContain("Lead Generation");

    const two = buildKickoffBriefing({
      contact: null,
      scope: [],
      hasSignedContract: true,
      contractTitles: ["Termo A", "Termo B"],
    });
    expect(dump(two.content?.slice(0, 2))).toContain("Contratos assinados");
    expect(dump(two.content?.slice(0, 2))).toContain("Termo B");
  });

  it("never carries a monetary amount", () => {
    const doc = buildKickoffBriefing({
      contact: { name: "ACME" },
      scope: [{ key: "service", heading: "SERVIÇO CONTRATADO", lines: ["Gestão de Tráfego Pago"] }],
      hasSignedContract: true,
    });
    expect(dump(doc)).not.toMatch(/R\$|valor/i);
  });

  it("explains the gap when there is no scope", () => {
    const noContract = dump(buildKickoffBriefing({ contact: null, scope: [], hasSignedContract: false }));
    expect(noContract).toContain("não tem contrato assinado");
    const unparsed = dump(buildKickoffBriefing({ contact: null, scope: [], hasSignedContract: true }));
    expect(unparsed).toContain("Não foi possível extrair");
  });

  it("omits the observations block when empty", () => {
    const s = dump(buildKickoffBriefing({ contact: null, scope: [], hasSignedContract: false, observations: "  \n " }));
    expect(s).not.toContain("Observações do comercial");
  });
});
