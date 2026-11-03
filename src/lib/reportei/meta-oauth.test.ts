import { describe, expect, it } from "vitest";
import { buildAuthUrl, safeReturnTo, signState, verifyState, withMetaResult } from "./meta-oauth";

const SECRET = "test-secret";

describe("signState / verifyState", () => {
  it("round-trips the user, account and return path", () => {
    const token = signState({ u: "user-1", a: "acct-1", r: "/operational/reportei/clientes/x" }, SECRET);
    expect(verifyState(token, SECRET)).toMatchObject({ u: "user-1", a: "acct-1", r: "/operational/reportei/clientes/x" });
  });

  it("rejects a tampered payload or a different secret", () => {
    const token = signState({ u: "user-1", a: "acct-1", r: "/operational/reportei/clientes" }, SECRET);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "other", a: "acct-1", r: "/operational/reportei/clientes", n: "x", e: Date.now() + 1000 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyState(`${payload}.${sig}`, "another-secret")).toBeNull();
  });

  it("rejects an expired state and malformed input", () => {
    const token = signState({ u: "u", a: "a", r: "/operational/reportei/clientes" }, SECRET, 1_000);
    expect(verifyState(token, SECRET, 1_000 + 11 * 60 * 1000)).toBeNull();
    expect(verifyState(null, SECRET)).toBeNull();
    expect(verifyState("nope", SECRET)).toBeNull();
    expect(verifyState("a.b.c", SECRET)).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("keeps paths inside Reportei, with their query", () => {
    expect(safeReturnTo("/operational/reportei/clientes/abc?novo=1")).toBe("/operational/reportei/clientes/abc?novo=1");
  });

  it.each([null, "", "https://evil.example/operational/reportei/x", "//evil.example", "/operational/clients", "/operational/reportei/\\evil", "/operational/reportei/x\r\nSet-Cookie: a=b"])(
    "falls back for %j",
    (raw) => {
      expect(safeReturnTo(raw)).toBe("/operational/reportei/clientes");
    },
  );
});

describe("withMetaResult", () => {
  it("adds or replaces meta and keeps other params", () => {
    expect(withMetaResult("/operational/reportei/clientes/x?novo=1", "connected")).toBe("/operational/reportei/clientes/x?novo=1&meta=connected");
    expect(withMetaResult("/operational/reportei/clientes/x?meta=error&novo=1", "connected")).toBe("/operational/reportei/clientes/x?meta=connected&novo=1");
  });
});

describe("buildAuthUrl with a Login for Business configuration", () => {
  it("sends config_id instead of scope and still asks for a code", () => {
    const url = new URL(buildAuthUrl({ appId: "123", redirectUri: "https://aureonag.com/cb", state: "s", configId: "999" }));
    expect(url.searchParams.get("config_id")).toBe("999");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("buildAuthUrl", () => {
  it("asks only for ads_read and carries the state", () => {
    const url = new URL(buildAuthUrl({ appId: "123", redirectUri: "https://aureonag.com/api/operational/reportei/meta/callback", state: "s" }));
    expect(url.origin + url.pathname).toMatch(/^https:\/\/www\.facebook\.com\/v\d+\.\d+\/dialog\/oauth$/);
    expect(url.searchParams.get("scope")).toBe("ads_read");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("client_id")).toBe("123");
  });
});
