import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { officeBody, officeQuery, requireSameOrigin, officeError, OfficeHttpError } from "./http";
import { OfficeGatewayClientError } from "./gateway/client";
import { OfficeRuntimeError } from "./runtime/service.cjs";

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("https://crm.test/api/office/interface/message", {
    method: "POST",
    headers: { origin: "https://crm.test", "content-type": "application/json", ...headers },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("office HTTP boundary", () => {
  it.each([403, 409, 429, 503])("preserves gateway status %s without revoking the CRM identity", async status => {
    const response = officeError(new OfficeGatewayClientError(status));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.code).not.toBe("OFFICE_ACCESS_DENIED");
    expect(body.code).not.toBe("OFFICE_SESSION_REQUIRED");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it("accepts only a same-origin JSON object", async () => {
    expect(await officeBody(post('{"text":"olá"}'))).toEqual({ text: "olá" });
  });
  it.each(["https://outside.test", "null", ""])("rejects Origin %s", async origin => {
    await expect(officeBody(post("{}", { origin }))).rejects.toMatchObject({ status: 403 });
  });
  it("rejects a cross-site fetch even with a forged origin", () => {
    expect(() => requireSameOrigin(post("{}", { "sec-fetch-site": "cross-site" }))).toThrow(OfficeHttpError);
  });
  it("rejects a form or text content type", async () => {
    await expect(officeBody(post("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
  });
  it.each(["[]", "null", "1", '"string"', "{"])("rejects invalid JSON object %s", async raw => {
    await expect(officeBody(post(raw))).rejects.toMatchObject({ status: 400 });
  });
  it("rejects announced oversize content before consuming it", async () => {
    await expect(officeBody(post("{}", { "content-length": "524289" }))).rejects.toMatchObject({ status: 413 });
  });
  it("bounds the actual body when content-length is absent", async () => {
    await expect(officeBody(post(JSON.stringify({ text: "x".repeat(524288) })))).rejects.toMatchObject({ status: 413 });
  });
  it("rejects duplicate query keys", () => {
    expect(() => officeQuery(new Request("https://crm.test/api/office/interface/messages?conversation=a&conversation=b"))).toThrow(OfficeHttpError);
  });
  it("preserves one bounded query value", () => {
    expect(officeQuery(new Request("https://crm.test/api/office/interface/messages?conversation=channel%3Ateam"))).toEqual({ conversation: "channel:team" });
  });
  it("returns known errors privately and hides unexpected error contents", async () => {
    const known = officeError(new OfficeRuntimeError(409, "Recarregue o escritório."));
    expect(known.status).toBe(409);
    expect(known.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(known.headers.get("vary")).toBe("Cookie");
    const unknown = officeError(new Error("private message, key or SQL detail"));
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain("private");
  });
});


describe("office public origin behind a proxy", () => {
  function proxyPost(origin: string | null = "https://aureonag.com", extras: Record<string, string> = {}) {
    return new Request("http://127.0.0.1:3000/api/office/interface/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }), ...extras },
      body: "{}",
    });
  }
  function production(site: string | undefined = "https://aureonag.com") {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  }

  it.each(["https://aureonag.com", "https://aureonag.com/"])("accepts public Origin from the explicit production setting %s", async configured => {
    production(configured);
    const request = proxyPost("https://aureonag.com", { "sec-fetch-site": "same-origin" });
    expect(new URL(request.url).origin).toBe("http://127.0.0.1:3000");
    expect(await officeBody(request)).toEqual({});
  });

  it.each([null, "null", "", "https://evil.test", "http://127.0.0.1:3000", "https://aureonag.com/", "https://aureonag.com.evil.test", "https://aureonag.com, https://evil.test"])("rejects missing, malformed or different Origin %s", async origin => {
    production();
    await expect(officeBody(proxyPost(origin))).rejects.toMatchObject({ status: 403, code: "OFFICE_ORIGIN_REJECTED" });
  });

  it("rejects cross-site requests even with an exact configured Origin", async () => {
    production();
    await expect(officeBody(proxyPost("https://aureonag.com", { "sec-fetch-site": "cross-site" })))
      .rejects.toMatchObject({ status: 403, code: "OFFICE_ORIGIN_REJECTED" });
  });

  it("does not trust Host or forwarded headers to authorize another origin", () => {
    production();
    expect(() => requireSameOrigin(proxyPost("https://evil.test", {
      host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https",
    }))).toThrow(OfficeHttpError);
    expect(() => requireSameOrigin(proxyPost("https://aureonag.com", {
      host: "internal.invalid", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http",
    }))).not.toThrow();
  });

  it("fails closed when production has no configured public origin", async () => {
    production();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
    await expect(officeBody(proxyPost())).rejects.toMatchObject({ status: 503 });
    await expect(officeBody(post("{}"))).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    "", "   ", "not-a-url", "http://aureonag.com", "https://user:password@aureonag.com",
    "https://@aureonag.com", "https://:@aureonag.com", "https://aureonag.com/path", "https://aureonag.com/./", "https://aureonag.com?", "https://aureonag.com/#",
    "https://aureonag.com/?query=value", "https://aureonag.com/#fragment", "https://aureonag.com\\path",
    "https://aureonag.com:invalid", "https://aureonag.com https://evil.test",
  ])("fails closed for invalid explicit configuration %s, without a direct-origin fallback", async configured => {
    production(configured);
    await expect(officeBody(post("{}"))).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("NODE_ENV", "development");
    await expect(officeBody(post("{}"))).rejects.toMatchObject({ status: 503 });
  });

  it.each(["development", "test"])("preserves direct same-origin use without config only in %s", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    expect(await officeBody(post("{}"))).toEqual({});
    await expect(officeBody(proxyPost())).rejects.toMatchObject({ status: 403 });
  });

  it("returns a safe origin-rejection code without disclosing either origin", async () => {
    production();
    let failure: unknown;
    try { requireSameOrigin(proxyPost("https://evil.test")); } catch (error) { failure = error; }
    const response = officeError(failure);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Reabra o escritório pelo CRM.", code: "OFFICE_ORIGIN_REJECTED" });
  });
});
