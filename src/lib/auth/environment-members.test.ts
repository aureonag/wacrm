import { describe, expect, it } from "vitest";
import { pickEnvironmentMembers } from "./environment-members";

const roles = [
  { id: "admin", environments: ["comercial", "operational"] },
  { id: "comercial", environments: ["comercial"] },
  { id: "operacional", environments: ["operational"] },
  { id: "vazio", environments: [] },
];

const profiles = [
  { id: "1", full_name: "Allan", email: "a@x", account_role: "owner", role_id: null },
  { id: "2", full_name: "Mídia", email: "m@x", account_role: "admin", role_id: "admin" },
  { id: "3", full_name: "Vendedor", email: "v@x", account_role: "agent", role_id: "comercial" },
  { id: "4", full_name: "Criação", email: "c@x", account_role: "agent", role_id: "operacional" },
  { id: "5", full_name: "Sem acesso", email: "s@x", account_role: "agent", role_id: "vazio" },
  { id: "6", full_name: null, email: "sem-cargo@x", account_role: "agent", role_id: null },
];

describe("pickEnvironmentMembers", () => {
  it("Comercial: owner + cargos with the comercial environment, nobody else", () => {
    expect(pickEnvironmentMembers(profiles, roles, "comercial").map((m) => m.name)).toEqual(["Allan", "Mídia", "Vendedor"]);
  });

  it("Operacional: owner + cargos with the operational environment", () => {
    expect(pickEnvironmentMembers(profiles, roles, "operational").map((m) => m.name)).toEqual(["Allan", "Criação", "Mídia"]);
  });

  it("a person without cargo only gets in as owner", () => {
    const ids = pickEnvironmentMembers(profiles, roles, "comercial").map((m) => m.id);
    expect(ids).not.toContain("6");
    expect(ids).not.toContain("5");
  });

  it("falls back to the e-mail when there is no name", () => {
    const list = pickEnvironmentMembers(
      [{ id: "9", full_name: "  ", email: "fulano@x", account_role: "owner", role_id: null }],
      [],
      "comercial",
    );
    expect(list[0].name).toBe("fulano@x");
  });
});
