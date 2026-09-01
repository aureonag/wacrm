import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, maskEmail } from "./otp";

describe("generateOtp", () => {
  it("produces a 6-digit numeric code whose hash matches hashOtp", () => {
    const otp = generateOtp();
    expect(otp.code).toMatch(/^\d{6}$/);
    expect(otp.hash).toBe(hashOtp(otp.code));
  });

  it("sets an expiry 10 minutes out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const otp = generateOtp(now);
    expect(otp.expiresAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });
});

describe("maskEmail", () => {
  it("keeps the domain and masks most of the local part", () => {
    expect(maskEmail("cliente@dominio.com")).toBe("cli****@dominio.com");
  });

  it("never reveals more than 3 leading characters", () => {
    expect(maskEmail("ab@dominio.com")).toBe("ab***@dominio.com");
  });

  it("returns the input unchanged when there's no @ to split on", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});
