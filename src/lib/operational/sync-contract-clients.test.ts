import { describe, expect, it } from "vitest";
import { clientNameFromTitle, findMatchingClient, nameKey } from "./sync-contract-clients";

describe("clientNameFromTitle", () => {
  it("strips the contract number", () => {
    expect(clientNameFromTitle("00351 - CG Complemento")).toBe("CG Complemento");
    expect(clientNameFromTitle("Kickoff - 00351 - CG Complemento")).toBe("CG Complemento");
  });
  it("keeps a title without number", () => {
    expect(clientNameFromTitle("Pink Heels")).toBe("Pink Heels");
  });
  it("empty -> null", () => {
    expect(clientNameFromTitle("  ")).toBeNull();
    expect(clientNameFromTitle(null)).toBeNull();
  });
});

describe("nameKey", () => {
  it("ignores accents, case, spaces and punctuation", () => {
    expect(nameKey("Pink Heels")).toBe(nameKey("PinkHeels"));
    expect(nameKey("Galápagos")).toBe(nameKey("galapagos"));
    expect(nameKey("Forza BR")).toBe("forzabr");
  });
});

describe("findMatchingClient", () => {
  const clients = [
    { id: "1", name: "Pink Heels", code: "00175", contract_id: null },
    { id: "2", name: "Scarliet", code: "00353", contract_id: null },
    { id: "3", name: "4 Irmãos", code: "00301", contract_id: null },
    { id: "4", name: "Amexlog", code: "00301", contract_id: null },
  ];
  it("matches by name", () => {
    expect(findMatchingClient(clients, "PinkHeels", "00175")?.id).toBe("1");
  });
  it("matches by same code when one name contains the other", () => {
    expect(findMatchingClient(clients, "Scarliet Estrias", "00353")?.id).toBe("2");
  });
  it("does not match different clients that merely share a code", () => {
    expect(findMatchingClient(clients, "CNV Seguros", "00301")).toBeNull();
  });
  it("no match -> null", () => {
    expect(findMatchingClient(clients, "Forza BR", "00337")).toBeNull();
  });
});
