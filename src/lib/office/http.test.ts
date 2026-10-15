import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => vi.restoreAllMocks());

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
