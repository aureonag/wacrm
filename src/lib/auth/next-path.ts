// Where to send a person after they sign in. A link to a page inside the CRM
// (e.g. a task) must work for someone who is not logged in: they are sent to the
// login with `?next=<that path>` and come back to it afterwards.
//
// Only a path of THIS site is accepted (never a full URL or a "//host" path),
// otherwise the login page could be used to bounce people to another site.

export const NEXT_PARAM = "next";

/** `raw` if it is a safe in-site path ("/operational/boards/…?task=…"), else null. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  // `_rsc` is Next's own channel for in-app navigation. When the session expires in the
  // middle of a client-side navigation the request that got bounced carries it, and
  // landing on "/page?_rsc=…" after login shows the raw payload instead of the page.
  if (value.startsWith("/") && !value.startsWith("//") && value.includes("_rsc=")) {
    try {
      const url = new URL(value, "http://local.invalid");
      url.searchParams.delete("_rsc");
      value = url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  if (value.length > 1000) return null;
  // Do not loop back into the auth pages.
  if (/^\/(login|signup|forgot-password|reset-password)(\/|\?|$)/.test(value)) return null;
  return value;
}

/** `/login?next=<path>` for a page the person tried to open without a session. */
export function loginUrlFor(path: string): string {
  const safe = safeNextPath(path);
  return safe ? `/login?${NEXT_PARAM}=${encodeURIComponent(safe)}` : "/login";
}
