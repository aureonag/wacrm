// Number and date formatting for Reportei screens (pt-BR, like the rest of the CRM).

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const intFmt = new Intl.NumberFormat("pt-BR");
const decFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** YYYY-MM-DD → DD/MM/YYYY (no timezone shift). */
export const showDate = (ymd: string) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));
export const showDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const formatInt = (n: number) => intFmt.format(n);
export const formatDec = (n: number) => decFmt.format(n);

export function formatMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return decFmt.format(value);
  }
}

/** The value of one metric as the screens show it. */
export function formatMetric(key: "spend" | "impressions" | "reach" | "clicks" | "ctr" | "cpc" | "cpm", value: number, currency: string | null): string {
  switch (key) {
    case "spend":
    case "cpc":
    case "cpm":
      return formatMoney(value, currency);
    case "ctr":
      return `${decFmt.format(value)}%`;
    default:
      return intFmt.format(value);
  }
}
