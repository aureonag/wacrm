// Shared types + validation for Afiliados campaigns and participants.
// Pure functions (no server-only imports) so the editor can reuse the types.

export type DiscountType = "PERCENTAGE" | "CURRENCY";
export type Frequency = "RECURRENT" | "PERIODIC";
export type RewardType = "PIX" | "GIFTBACK" | "OTHER";

export interface Reward {
  /** Competência (YYYY-MM). */
  month: string;
  type: RewardType;
  /** % sobre o volume de vendas do afiliado; null para OTHER. */
  value: number | null;
  description: string;
}

export interface CampaignHistoryEntry {
  revision: number;
  changed_at: string;
  changed_by: string | null;
  policy: string;
  discount: number;
  rewards: Reward[];
}

export interface Campaign {
  id: string;
  client_id: string;
  name: string;
  description: string;
  policy: string;
  discount_type: DiscountType;
  discount: number;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  rewards: Reward[];
  status: "active" | "inactive";
  revision: number;
  history: CampaignHistoryEntry[];
  created_at: string;
  updated_at: string;
  participants?: number;
}

export interface CampaignInput {
  name: string;
  description: string;
  policy: string;
  discount_type: DiscountType;
  discount: number;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  rewards: Reward[];
}

export class BadInput extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function reqText(v: unknown, max: number, message: string): string {
  if (typeof v !== "string" || !v.trim()) throw new BadInput(message);
  const s = v.trim();
  if (s.length > max) throw new BadInput("Texto longo demais.");
  return s;
}

function parseRewards(raw: unknown, frequency: Frequency, startMonth: string): Reward[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadInput("Recompensas inválidas.");
  if (raw.length > 60) throw new BadInput("Recompensas demais.");
  const seen = new Set<string>();
  const out: Reward[] = [];
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const month = typeof r.month === "string" ? r.month : "";
    if (!MONTH_RE.test(month)) throw new BadInput("Competência da recompensa inválida.");
    if (frequency === "PERIODIC" && month !== startMonth) {
      throw new BadInput("Campanha de período definido tem uma única recompensa, no mês de início.");
    }
    if (frequency === "RECURRENT" && month < startMonth) {
      throw new BadInput("Recompensa anterior ao início da campanha.");
    }
    if (seen.has(month)) throw new BadInput("Há duas recompensas na mesma competência.");
    seen.add(month);

    const type = r.type;
    if (type !== "PIX" && type !== "GIFTBACK" && type !== "OTHER") throw new BadInput("Tipo de recompensa inválido.");
    const description = typeof r.description === "string" ? r.description.trim() : "";
    if (description.length > 2000) throw new BadInput("Descrição da recompensa longa demais.");
    if (type === "OTHER") {
      if (!description) throw new BadInput("Descreva a premiação não monetária.");
      out.push({ month, type, value: null, description });
    } else {
      const value = Number(r.value);
      if (!Number.isFinite(value) || value <= 0 || value > 100) {
        throw new BadInput("O percentual da recompensa deve ser maior que 0 e até 100.");
      }
      out.push({ month, type, value, description });
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Validates a campaign body (create, or full edit). Throws BadInput. */
export function parseCampaignInput(body: unknown): CampaignInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = reqText(b.name, 200, "Informe o nome da campanha.");
  const description = reqText(b.description, 20000, "Informe a descrição da campanha.");
  const policy = reqText(b.policy, 20000, "Informe a política da campanha.");

  const discount_type = b.discount_type;
  if (discount_type !== "PERCENTAGE" && discount_type !== "CURRENCY") throw new BadInput("Tipo de desconto inválido.");
  const discount = Number(b.discount);
  if (!Number.isFinite(discount) || discount <= 0) throw new BadInput("Informe um desconto maior que zero.");
  if (discount_type === "PERCENTAGE" && discount > 100) throw new BadInput("O desconto percentual não pode passar de 100.");
  if (discount > 1_000_000) throw new BadInput("Desconto alto demais.");

  const frequency = b.frequency;
  if (frequency !== "RECURRENT" && frequency !== "PERIODIC") throw new BadInput("Selecione a frequência da campanha.");

  const start_date = typeof b.start_date === "string" ? b.start_date : "";
  if (!isRealDate(start_date)) throw new BadInput("Data de início inválida.");
  let end_date: string | null = null;
  if (frequency === "PERIODIC") {
    end_date = typeof b.end_date === "string" ? b.end_date : "";
    if (!isRealDate(end_date)) throw new BadInput("Data de fim inválida.");
    if (end_date < start_date) throw new BadInput("A data de fim deve ser igual ou posterior à de início.");
  }

  const rewards = parseRewards(b.rewards, frequency, start_date.slice(0, 7));
  return { name, description, policy, discount_type, discount, frequency, start_date, end_date, rewards };
}

export interface AffiliateInput {
  name: string;
  email: string;
  phone: string | null;
  instagram: string | null;
  campaign_id: string;
  code: string;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
}

export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "phone", "random"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function optText(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new BadInput("Campo inválido.");
  const s = v.trim();
  if (s.length > max) throw new BadInput("Texto longo demais.");
  return s === "" ? null : s;
}

/** Validates the manual "novo afiliado" body. Throws BadInput. */
export function parseAffiliateInput(body: unknown): AffiliateInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = reqText(b.name, 200, "Informe o nome do afiliado.");
  const email = reqText(b.email, 200, "Informe o e-mail do afiliado.").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadInput("E-mail inválido.");
  if (!isUuid(b.campaign_id)) throw new BadInput("Selecione a campanha.");
  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,30}$/.test(code)) throw new BadInput("O código do cupom deve ter de 3 a 30 letras ou números.");
  const pix_key = optText(b.pix_key, 200);
  const pixType = optText(b.pix_key_type, 20);
  if (pixType && !(PIX_KEY_TYPES as readonly string[]).includes(pixType)) throw new BadInput("Tipo de chave Pix inválido.");
  if (pix_key && !pixType) throw new BadInput("Selecione o tipo da chave Pix.");
  return {
    name,
    email,
    phone: optText(b.phone, 40),
    instagram: optText(b.instagram, 100),
    campaign_id: b.campaign_id,
    code,
    pix_key_type: pix_key ? (pixType as PixKeyType) : null,
    pix_key,
  };
}
