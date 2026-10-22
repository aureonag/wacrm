// Public sign-up + portal profile validation (pure, shared by API and UI).

import { BadInput, PIX_KEY_TYPES, isUuid, type PixKeyType } from "./campaigns";

export interface RegisterInput {
  campaign_id: string;
  revision: number;
  name: string;
  email: string;
  instagram: string | null;
  phone: string;
  city: string;
  /** Two-letter UF, upper case. */
  state: string;
  pix_key_type: PixKeyType;
  /** Already normalized for its type (digits only for CPF/CNPJ). */
  pix_key: string;
  password: string;
  /** 6-digit code e-mailed to the address (confirms it belongs to the person). */
  code: string;
  accept: true;
}

export interface SendCodeInput {
  campaign_id: string;
  email: string;
}

/** Validates the "send me a confirmation code" body. Throws BadInput. */
export function parseSendCodeInput(body: unknown): SendCodeInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.campaign_id)) throw new BadInput("Campanha inválida.");
  const email = (typeof b.email === "string" ? b.email.trim() : "").toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadInput("E-mail inválido.");
  return { campaign_id: b.campaign_id, email };
}

function optText(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new BadInput("Campo inválido.");
  const s = v.trim();
  if (s.length > max) throw new BadInput("Texto longo demais.");
  return s === "" ? null : s;
}

export const BR_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Light check of a Pix key against its type, so a typo does not block a payment
 * later: lengths for CPF/CNPJ/phone, e-mail shape, random key (EVP) shape.
 * Returns the normalized key, or null when it does not fit the type.
 */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const key = raw.trim();
  switch (type) {
    case "cpf": {
      const d = digitsOf(key);
      return d.length === 11 ? d : null;
    }
    case "cnpj": {
      const d = digitsOf(key);
      return d.length === 14 ? d : null;
    }
    case "phone": {
      const d = digitsOf(key);
      // DDD + number (10-11 digits), optionally with the country code 55.
      return d.length >= 10 && d.length <= 13 ? key : null;
    }
    case "email":
      return key.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) ? key.toLowerCase() : null;
    case "random":
      return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(key) ? key.toLowerCase() : null;
  }
}

/** Validates the public sign-up body. Throws BadInput. */
export function parseRegisterInput(body: unknown): RegisterInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.campaign_id)) throw new BadInput("Campanha inválida.");
  const revision = Number(b.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new BadInput("Campanha inválida.");

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 2 || name.length > 200) throw new BadInput("Informe seu nome completo.");
  const email = (typeof b.email === "string" ? b.email.trim() : "").toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadInput("E-mail inválido.");
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 10) throw new BadInput("A senha deve ter pelo menos 10 caracteres.");
  if (password.length > 72) throw new BadInput("A senha deve ter no máximo 72 caracteres.");
  if (b.accept !== true) throw new BadInput("É preciso aceitar as regras da campanha.");
  const code = typeof b.code === "string" ? b.code.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new BadInput("Informe o código de 6 dígitos enviado ao seu e-mail.");


  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  if (phone.length > 40 || digitsOf(phone).length < 10) throw new BadInput("Informe seu telefone com DDD.");
  const city = typeof b.city === "string" ? b.city.trim() : "";
  if (city.length < 2 || city.length > 100) throw new BadInput("Informe sua cidade.");
  const state = (typeof b.state === "string" ? b.state.trim() : "").toUpperCase();
  if (!(BR_STATES as readonly string[]).includes(state)) throw new BadInput("Informe o estado (UF).");
  const pixType = typeof b.pix_key_type === "string" ? b.pix_key_type : "";
  if (!(PIX_KEY_TYPES as readonly string[]).includes(pixType)) throw new BadInput("Selecione o tipo da chave Pix.");
  const pix_key = normalizePixKey(pixType as PixKeyType, typeof b.pix_key === "string" ? b.pix_key : "");
  if (!pix_key) throw new BadInput("A chave Pix não confere com o tipo escolhido. Confira e tente de novo.");

  return {
    campaign_id: b.campaign_id,
    revision,
    name,
    email,
    instagram: optText(b.instagram, 100),
    phone,
    city,
    state,
    pix_key_type: pixType as PixKeyType,
    pix_key,
    password,
    code,
    accept: true,
  };
}

/** Coupon code candidate from the person's name: letters + random digits. */
export function couponCandidate(name: string, attempt: number): string {
  const letters = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
  const base = letters.length >= 3 ? letters : (letters + "AFF").slice(0, 3);
  const digits = attempt < 4 ? 2 : attempt < 8 ? 3 : 4;
  const n = Math.floor(Math.random() * 10 ** digits);
  return `${base}${String(n).padStart(digits, "0")}`;
}

export interface ProfileInput {
  name: string;
  phone: string | null;
  instagram: string | null;
  city: string | null;
  state: string | null;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
}

/** Validates the affiliate's own profile edit. Throws BadInput. */
export function parseProfileInput(body: unknown): ProfileInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 2 || name.length > 200) throw new BadInput("Informe seu nome.");
  const pix_key = optText(b.pix_key, 200);
  const pixType = optText(b.pix_key_type, 20);
  if (pixType && !(PIX_KEY_TYPES as readonly string[]).includes(pixType)) throw new BadInput("Tipo de chave Pix inválido.");
  if (pix_key && !pixType) throw new BadInput("Selecione o tipo da chave Pix.");
  const state = optText(b.state, 2);
  return {
    name,
    phone: optText(b.phone, 40),
    instagram: optText(b.instagram, 100),
    city: optText(b.city, 100),
    state: state ? state.toUpperCase() : null,
    pix_key_type: pix_key ? (pixType as PixKeyType) : null,
    pix_key,
  };
}
