// Public sign-up + portal profile validation (pure, shared by API and UI).

import { BadInput, PIX_KEY_TYPES, isUuid, type PixKeyType } from "./campaigns";

export interface RegisterInput {
  campaign_id: string;
  revision: number;
  name: string;
  email: string;
  instagram: string | null;
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

  return { campaign_id: b.campaign_id, revision, name, email, instagram: optText(b.instagram, 100), password, code, accept: true };
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
