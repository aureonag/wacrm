import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/operational/clients-projects";
import { parseReporteiClientInput } from "./client-settings";

describe("parseReporteiClientInput", () => {
  it("applies Reportei's defaults and trims the name", () => {
    expect(parseReporteiClientInput({ name: "  CG Complemento  " })).toEqual({
      name: "CG Complemento",
      code: null,
      locale: "pt-BR",
      dateFormat: "DD/MM/YYYY",
      decimalFormat: "comma",
    });
  });

  it("pads a numeric contract code to 5 digits", () => {
    expect(parseReporteiClientInput({ name: "A", code: "351" }).code).toBe("00351");
  });

  it("accepts the other options", () => {
    const r = parseReporteiClientInput({ name: "A", locale: "en", dateFormat: "MM/DD/YYYY", decimalFormat: "dot" });
    expect([r.locale, r.dateFormat, r.decimalFormat]).toEqual(["en", "MM/DD/YYYY", "dot"]);
  });

  it.each([
    [null],
    [{}],
    [{ name: "   " }],
    [{ name: "A", locale: "fr" }],
    [{ name: "A", dateFormat: "YYYY-MM-DD" }],
    [{ name: "A", decimalFormat: "space" }],
    [{ name: "A".repeat(201) }],
    [{ name: "A", code: 12 }],
  ])("rejects invalid input %j", (body) => {
    expect(() => parseReporteiClientInput(body)).toThrow(ValidationError);
  });
});
