import { describe, expect, it } from "vitest";
import { csvCell, summariesToCsv } from "./csv";
import { summarizeClient } from "./dashboard";

const ins = (spend: number, impressions: number, clicks: number) => ({ spend, impressions, reach: 0, clicks, ctr: 0, cpc: 0, cpm: 0, leads: 0, conversations: 0, costPerLead: 0 });
const labels = { client: "Cliente", code: "Código", accounts: "Contas", spend: "Gasto", clicks: "Cliques", ctr: "CTR", cpc: "CPC", versus: (m: string) => `${m} vs anterior (%)` };

describe("csvCell", () => {
  it("uses comma decimals and quotes what needs it", () => {
    expect(csvCell(1.5)).toBe("1,5");
    expect(csvCell('Acme; "Lda"')).toBe('"Acme; ""Lda"""');
    expect(csvCell(null)).toBe("");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+55 11")).toBe("'+55 11");
    expect(csvCell("Normal")).toBe("Normal");
  });
});

describe("summariesToCsv", () => {
  it("writes a BOM, the header and one line per client", () => {
    const row = summarizeClient({ clientId: "1", name: "Aureon", code: "AU" }, [
      { id: "a", name: "A", currency: "BRL", insights: ins(200, 1000, 100), previous: ins(100, 1000, 100) },
    ]);
    const csv = summariesToCsv([row], labels);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, line] = csv.slice(1).split("\r\n");
    expect(head).toBe("Cliente;Código;Contas;Gasto;Gasto vs anterior (%);Cliques;Cliques vs anterior (%);CTR;CTR vs anterior (%);CPC;CPC vs anterior (%)");
    expect(line).toBe("Aureon;AU;1/1;200;100;100;0;10;0;2;100");
  });

  it("leaves money empty when currencies are mixed and everything empty without data", () => {
    const mixed = summarizeClient({ clientId: "1", name: "M", code: null }, [
      { id: "a", name: "A", currency: "BRL", insights: ins(100, 1000, 50) },
      { id: "b", name: "B", currency: "USD", insights: ins(10, 1000, 10) },
    ]);
    const none = summarizeClient({ clientId: "2", name: "N", code: null }, [{ id: "c", name: "C", currency: "BRL", error: "permission" }]);
    const lines = summariesToCsv([mixed, none], labels).slice(1).split("\r\n");
    expect(lines[1]).toBe("M;;2/2;;;60;;3;;;");
    expect(lines[2]).toBe("N;;0/1;;;;;;;;");
  });
});
