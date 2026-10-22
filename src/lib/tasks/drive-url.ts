// Link of a task's materials folder (Google Drive & co.). One rule for the screen
// and the API: what people paste is kept as pasted, except that a missing
// "https://" is added and anything that is not a web link is refused (a
// `javascript:` link in a clickable field would run in the CRM's page).

export type DriveUrlResult = { ok: true; url: string | null } | { ok: false };

export function normalizeDriveUrl(raw: string | null | undefined): DriveUrlResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, url: null };
  if (/\s/.test(text)) return { ok: false };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const candidate = hasScheme ? text : `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false };
  if (!parsed.hostname.includes(".")) return { ok: false };
  return { ok: true, url: candidate };
}
