// Operacional → Reportei: preferences of a client's reports (step 1 of "Novo
// cliente", migration 158). Pure and server/client safe.

import { normalizeClientCode, ValidationError } from "@/lib/operational/clients-projects";

export const LOCALES = ["pt-BR", "en", "es"] as const;
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY"] as const;
export const DECIMAL_FORMATS = ["comma", "dot"] as const;

export type Locale = (typeof LOCALES)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type DecimalFormat = (typeof DECIMAL_FORMATS)[number];

export interface ReporteiClientInput {
  name: string;
  code: string | null;
  locale: Locale;
  dateFormat: DateFormat;
  decimalFormat: DecimalFormat;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new ValidationError(`${field} inválido.`);
  return v as T;
}

export function parseReporteiClientInput(body: unknown): ReporteiClientInput {
  if (!body || typeof body !== "object") throw new ValidationError("Dados inválidos.");
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) throw new ValidationError("Informe o nome do cliente.");
  const name = b.name.trim();
  if (name.length > 200) throw new ValidationError("Nome do cliente muito longo.");
  if (b.code !== undefined && b.code !== null && typeof b.code !== "string") throw new ValidationError("Código inválido.");
  const code = normalizeClientCode(b.code);
  if (code && code.length > 40) throw new ValidationError("Código muito longo.");
  return {
    name,
    code,
    locale: pick(b.locale, LOCALES, "pt-BR", "Idioma"),
    dateFormat: pick(b.dateFormat, DATE_FORMATS, "DD/MM/YYYY", "Formato da data"),
    decimalFormat: pick(b.decimalFormat, DECIMAL_FORMATS, "comma", "Separador decimal"),
  };
}
