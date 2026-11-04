import { describe, expect, it } from "vitest";
import { couponCandidate } from "./registration";

describe("couponCandidate (first name + discount)", () => {
  it("is the first name followed by the campaign discount", () => {
    expect(couponCandidate("Mauro Henrique", 0, 10)).toBe("MAURO10");
    expect(couponCandidate("Nicolle Sassá", 0, "10.00")).toBe("NICOLLE10");
    expect(couponCandidate("ana", 0, 15)).toBe("ANA15");
  });

  it("drops accents, spaces and symbols", () => {
    expect(couponCandidate("  José-Maria  da Silva", 0, 10)).toBe("JOSEMARIA10");
    expect(couponCandidate("Ângela Ünderline", 0, 10)).toBe("ANGELA10");
    expect(couponCandidate("João", 0, 10)).toBe("JOAO10");
  });

  it("adds surname letters, then a counter, keeping the discount at the end", () => {
    expect(couponCandidate("Mauro Henrique", 1, 10)).toBe("MAUROH10");
    expect(couponCandidate("Mauro Henrique", 2, 10)).toBe("MAUROHE10");
    expect(couponCandidate("Mauro Henrique", 6, 10)).toBe("MAUROHENRIQ10");
    expect(couponCandidate("Mauro Henrique", 7, 10)).toBe("MAURO110");
    expect(couponCandidate("Mauro Henrique", 8, 10)).toBe("MAURO210");
    // no surname: straight to the counter
    expect(couponCandidate("Mauro", 1, 10)).toBe("MAURO110");
  });

  it("every attempt is a different, valid code", () => {
    const seen = new Set<string>();
    for (let a = 0; a < 12; a++) {
      const code = couponCandidate("Mauro Henrique", a, 10);
      expect(code).toMatch(/^[A-Z0-9]{3,30}$/);
      expect(code.endsWith("10")).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBe(12);
  });

  it("falls back for names without Latin letters and for odd discounts", () => {
    expect(couponCandidate("李雷", 0, 10)).toBe("AFF10");
    expect(couponCandidate("Ana", 0, 7.5)).toBe("ANA8");
    expect(couponCandidate("Ana", 0, 0)).toBe("ANA");
    expect(couponCandidate("Ana", 0, 10).length).toBeGreaterThanOrEqual(3);
    expect(couponCandidate("A".repeat(60), 0, 10).length).toBeLessThanOrEqual(30);
  });
});
