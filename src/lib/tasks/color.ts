// Color helpers for the briefing highlighter (hex <-> HSV, readable text color).
// Pure: used by the picker UI and by the editor mark (which must only ever
// write a validated "#rrggbb" into the stored document / inline style).

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-1 */
  v: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** "#rgb" / "rgb" / "#rrggbb" / "rrggbb" -> "#RRGGBB" (upper case), or null when invalid. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? "#000000";
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** Text color that stays readable on top of `bg`: near-black on light fills, white on dark ones. */
export function readableTextColor(bg: string): string {
  const { r, g, b } = hexToRgb(bg);
  // Perceived brightness (YIQ); above ~150 a light fill needs dark text.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111827" : "#FFFFFF";
}

/** Basic colors offered next to the picker: strong primaries, their light tints, and neutrals. */
export const HIGHLIGHT_PRESETS: string[][] = [
  ["#FFEB3B", "#FB923C", "#EF4444", "#EC4899", "#A855F7", "#3B82F6", "#06B6D4", "#22C55E"],
  ["#FEF08A", "#FED7AA", "#FECACA", "#FBCFE8", "#E9D5FF", "#BFDBFE", "#A5F3FC", "#BBF7D0"],
  ["#FFFFFF", "#E5E7EB", "#9CA3AF", "#4B5563", "#000000"],
];

/** Color used for the first highlight (same orange the old highlighter had). */
export const DEFAULT_HIGHLIGHT = "#FB923C";
