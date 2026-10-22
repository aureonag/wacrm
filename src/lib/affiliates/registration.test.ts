import { describe, expect, it } from "vitest";
import { BadInput } from "./campaigns";
import { normalizePixKey, parseRegisterInput } from "./registration";

const VALID = {
  campaign_id: "5b8d9d9e-8f1c-4f3a-9a52-0a3b2c1d4e5f",
  revision: 1,
  name: "Nicolle Sassá",
  email: "Nicolle@Example.com",
  instagram: "@nicolle",
  phone: "(11) 95166-7706",
  city: "Guarulhos",
  state: "sp",
  pix_key_type: "cpf",
  pix_key: "123.456.789-01",
  password: "uma-senha-longa-123",
  code: "123456",
  accept: true,
};

describe("normalizePixKey", () => {
  it("keeps only the digits of a CPF/CNPJ and checks the length", () => {
    expect(normalizePixKey("cpf", "123.456.789-01")).toBe("12345678901");
    expect(normalizePixKey("cpf", "123.456.789")).toBeNull();
    expect(normalizePixKey("cnpj", "12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizePixKey("cnpj", "12345678901")).toBeNull();
  });

  it("accepts a phone with DDD, with or without country code", () => {
    expect(normalizePixKey("phone", "11951667706")).toBe("11951667706");
    expect(normalizePixKey("phone", "+55 11 95166-7706")).toBe("+55 11 95166-7706");
    expect(normalizePixKey("phone", "95166770")).toBeNull();
  });

  it("checks the e-mail shape and lower-cases it", () => {
    expect(normalizePixKey("email", "Maria@Loja.com")).toBe("maria@loja.com");
    expect(normalizePixKey("email", "maria@loja")).toBeNull();
  });

  it("accepts a random (EVP) key", () => {
    expect(normalizePixKey("random", "123E4567-E89B-12D3-A456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(normalizePixKey("random", "nao-e-uma-chave")).toBeNull();
  });
});

describe("parseRegisterInput (contact + Pix)", () => {
  it("normalizes the new fields", () => {
    const out = parseRegisterInput(VALID);
    expect(out.email).toBe("nicolle@example.com");
    expect(out.state).toBe("SP");
    expect(out.city).toBe("Guarulhos");
    expect(out.pix_key_type).toBe("cpf");
    expect(out.pix_key).toBe("12345678901");
    expect(out.phone).toBe("(11) 95166-7706");
  });

  it.each([
    ["phone", { phone: "1234" }],
    ["city", { city: " " }],
    ["state", { state: "XX" }],
    ["pix type", { pix_key_type: "outro" }],
    ["pix key for its type", { pix_key: "123" }],
  ])("rejects a bad %s", (_label, patch) => {
    expect(() => parseRegisterInput({ ...VALID, ...patch })).toThrow(BadInput);
  });

  it("requires the Pix key (no silent empty)", () => {
    expect(() => parseRegisterInput({ ...VALID, pix_key: undefined })).toThrow(BadInput);
  });
});
