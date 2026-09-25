import { describe, expect, it } from "vitest";
import { landingPathFor } from "./landing";

describe("landingPathFor", () => {
  it("sends Criação, Mídia and Social to Operacional", () => {
    expect(landingPathFor(["Criação"])).toBe("/operational/dashboard");
    expect(landingPathFor(["Mídia"])).toBe("/operational/dashboard");
    expect(landingPathFor(["Social"])).toBe("/operational/dashboard");
    expect(landingPathFor(["Criação", "Mídia"])).toBe("/operational/dashboard");
  });
  it("keeps Comercial in the CRM", () => {
    expect(landingPathFor(["Comercial"])).toBeNull();
  });
  it("keeps people with no sector, or in both worlds, in the CRM", () => {
    expect(landingPathFor([])).toBeNull();
    expect(landingPathFor(["Comercial", "Criação"])).toBeNull();
  });
});
