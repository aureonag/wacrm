import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createOfficeGatewayProtocol, decodeOfficeGatewayKey, OfficeGatewayError,
  OFFICE_GATEWAY_BODY_LIMITS, OFFICE_GATEWAY_HEADERS as H, OFFICE_GATEWAY_PATHS,
  type OfficeGatewayAudience, type OfficeGatewayHeaderInput, type OfficeGatewayRequest,
} from "./protocol";

const KEY = Buffer.from("0123456789abcdef".repeat(4), "hex");
function fixture(audience: OfficeGatewayAudience = "runtime", maxReplayEntries = 10_000) {
  let clock = 1_000_000;
  const protocol = createOfficeGatewayProtocol({ key: KEY, audience, now: () => clock, maxReplayEntries });
  const signed = protocol.sign('{"message":"Olá Aureon"}');
  const request = (headers: OfficeGatewayHeaderInput = signed.headers, body: Uint8Array = signed.body): OfficeGatewayRequest => ({
    method: "POST", path: OFFICE_GATEWAY_PATHS[audience], headers, body,
  });
  return { protocol, signed, request, time: (value: number) => { clock = value; } };
}
function resign(headers: Record<string, string>, body: Uint8Array, audience: OfficeGatewayAudience = "runtime") {
  const canonical = ["v1", audience, headers[H.timestamp], headers[H.nonce], createHash("sha256").update(body).digest("hex")].join("\n");
  return { ...headers, [H.signature]: createHmac("sha256", KEY).update(canonical, "utf8").digest("hex") };
}

describe("office gateway configuration", () => {
  it("decodes exactly 32 bytes of hex, ignoring only outer whitespace and hex casing", () => {
    expect(decodeOfficeGatewayKey(` \n${KEY.toString("hex").toUpperCase()}\r\n`)).toEqual(KEY);
  });

  it.each([undefined, "", "a".repeat(63), "a".repeat(65), "a".repeat(128), "g".repeat(64), "aa ".repeat(32)])(
    "fails closed for malformed key encoding (%s)", value => {
      expect(() => decodeOfficeGatewayKey(value)).toThrow(OfficeGatewayError);
      try { decodeOfficeGatewayKey(value); } catch (error) {
        expect(error).toMatchObject({ status: 503, code: "OFFICE_GATEWAY_UNAVAILABLE" });
        expect(error).not.toHaveProperty("cause");
        if (value) expect(String(error)).not.toContain(value);
      }
    },
  );

  it.each([0, 31, 33, 64])("requires an injected key of exactly 32 bytes (%s)", size => {
    expect(() => createOfficeGatewayProtocol({ key: new Uint8Array(size), audience: "runtime" })).toThrow(OfficeGatewayError);
  });

  it.each([0, -1, 1.5, 10_001, Number.NaN])("keeps replay capacity bounded (%s)", maxReplayEntries => {
    expect(() => createOfficeGatewayProtocol({ key: KEY, audience: "runtime", maxReplayEntries })).toThrow(OfficeGatewayError);
  });

  it("owns a copy of the key instead of retaining a caller-mutable buffer", () => {
    const input = Buffer.from(KEY), expected = Buffer.from(KEY);
    const protocol = createOfficeGatewayProtocol({ key: input, audience: "runtime", now: () => 1_000_000 });
    input.fill(0);
    const signed = protocol.sign("{}");
    const independent = createOfficeGatewayProtocol({ key: expected, audience: "runtime", now: () => 1_000_000 });
    expect(() => independent.verify({ method: "POST", path: OFFICE_GATEWAY_PATHS.runtime, ...signed })).not.toThrow();
  });
});

describe("byte-exact HMAC transport", () => {
  it.each(["runtime", "store"] as const)("signs and verifies the fixed %s audience/path", audience => {
    const f = fixture(audience);
    expect(f.signed.headers[H.version]).toBe("v1");
    expect(f.signed.headers[H.audience]).toBe(audience);
    expect(f.signed.headers[H.nonce]).toMatch(/^[0-9a-f]{32}$/);
    expect(f.signed.headers[H.signature]).toMatch(/^[0-9a-f]{64}$/);
    expect(f.signed.headers).toEqual(resign(f.signed.headers, f.signed.body, audience));
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it("owns the returned body and preserves UTF-8 bytes and offset views without JSON normalization", () => {
    const f = fixture();
    const input = Buffer.from('prefix{"nome":"João","lines":"a\\nb"}suffix');
    const view = new Uint8Array(input.buffer, input.byteOffset + 6, input.byteLength - 12);
    const signed = f.protocol.sign(view), expected = Buffer.from(view);
    input.fill(0);
    expect(signed.body).toEqual(expected);
    expect(() => f.protocol.verify(f.request(signed.headers, signed.body))).not.toThrow();
  });

  it("hashes raw bytes without decoding or replacing invalid UTF-8 before handler parsing", () => {
    const f = fixture(), bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    const signed = f.protocol.sign(bytes);
    expect(signed.body).toEqual(bytes);
    expect(() => f.protocol.verify(f.request(signed.headers, signed.body))).not.toThrow();
  });

  it("rejects changed JSON whitespace, body bytes, signature and key", () => {
    const f = fixture();
    expect(() => f.protocol.verify(f.request(f.signed.headers, Buffer.from(' {"message":"Olá Aureon"}')))).toThrow(OfficeGatewayError);
    const changed = { ...f.signed.headers, [H.signature]: "0".repeat(64) };
    expect(() => f.protocol.verify(f.request(changed))).toThrow(OfficeGatewayError);
    const other = createOfficeGatewayProtocol({ key: Buffer.alloc(32, 7), audience: "runtime", now: () => 1_000_000 });
    expect(() => other.verify(f.request())).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it("rejects cross-audience reuse, including a relabeled audience header", () => {
    const f = fixture("runtime"), store = fixture("store");
    const relabeled = { ...f.signed.headers, [H.audience]: "store" };
    expect(() => store.protocol.verify({ ...f.request(), path: OFFICE_GATEWAY_PATHS.store })).toThrow(OfficeGatewayError);
    expect(() => store.protocol.verify({ ...f.request(relabeled), path: OFFICE_GATEWAY_PATHS.store })).toThrow(OfficeGatewayError);
  });

  it.each([
    ["GET", "/v1/runtime"], ["post", "/v1/runtime"], ["POST", "/v1/runtime/"],
    ["POST", "/v1/runtime?x=1"], ["POST", "/v1/%72untime"], ["POST", "/api/office/backend-store"],
  ])("rejects any noncanonical method/path (%s %s)", (method, path) => {
    const f = fixture();
    expect(() => f.protocol.verify({ ...f.request(), method, path })).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it.each(["runtime", "store"] as const)("bounds %s bodies on both sign and verify", audience => {
    const f = fixture(audience), limit = OFFICE_GATEWAY_BODY_LIMITS[audience];
    const signed = f.protocol.sign(new Uint8Array(limit));
    expect(() => f.protocol.verify(f.request(signed.headers, signed.body))).not.toThrow();
    expect(() => f.protocol.sign(new Uint8Array(limit + 1))).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request(f.signed.headers, new Uint8Array(limit + 1)))).toThrow(OfficeGatewayError);
    try { f.protocol.verify(f.request(f.signed.headers, new Uint8Array(limit + 1))); } catch (error) {
      expect(error).toMatchObject({ status: 413, code: "OFFICE_GATEWAY_BODY_TOO_LARGE" });
    }
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it("applies the string limit to UTF-8 bytes rather than JavaScript character count", () => {
    const f = fixture(), text = "🦄".repeat(OFFICE_GATEWAY_BODY_LIMITS.runtime / 4 + 1);
    expect(text.length).toBeLessThan(OFFICE_GATEWAY_BODY_LIMITS.runtime);
    expect(() => f.protocol.sign(text)).toThrow(OfficeGatewayError);
  });
});

describe("canonical and unique HTTP fields", () => {
  it("accepts case-insensitive names, singleton raw arrays and standard Headers", () => {
    for (const mode of ["uppercase", "singleton", "headers"] as const) {
      const f = fixture();
      const headers = mode === "uppercase" ? Object.fromEntries(Object.entries(f.signed.headers).map(([key, value]) => [key.toUpperCase(), value])) :
        mode === "singleton" ? Object.fromEntries(Object.entries(f.signed.headers).map(([key, value]) => [key, [value]])) : new Headers(f.signed.headers);
      expect(() => f.protocol.verify(f.request(headers))).not.toThrow();
    }
  });

  it.each(["record", "pairs", "arrays", "headers", "comma"])("rejects duplicate required headers without consuming a nonce (%s)", mode => {
    const f = fixture();
    let headers: OfficeGatewayHeaderInput;
    if (mode === "record") headers = { ...f.signed.headers, [H.nonce.toUpperCase()]: f.signed.headers[H.nonce] };
    else if (mode === "pairs") headers = [...Object.entries(f.signed.headers), [H.nonce.toUpperCase(), f.signed.headers[H.nonce]]];
    else if (mode === "arrays") headers = { ...f.signed.headers, [H.nonce]: [f.signed.headers[H.nonce], f.signed.headers[H.nonce]] };
    else if (mode === "headers") { const combined = new Headers(f.signed.headers); combined.append(H.nonce, f.signed.headers[H.nonce]); headers = combined; }
    else headers = { ...f.signed.headers, [H.nonce]: f.signed.headers[H.nonce] + "," + f.signed.headers[H.nonce] };
    expect(() => f.protocol.verify(f.request(headers))).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it.each([
    [H.version, "v2"], [H.audience, "store"], [H.timestamp, "01000000"], [H.timestamp, "1e6"],
    [H.timestamp, "1000000 "], [H.timestamp, "9007199254740992"], [H.nonce, "AB".repeat(16)],
    [H.signature, "a".repeat(63)], [H.signature, "g".repeat(64)], [H.signature, "a".repeat(200)],
  ])("rejects noncanonical fields safely (%s)", (name, value) => {
    const f = fixture();
    expect(() => f.protocol.verify(f.request({ ...f.signed.headers, [name]: value }))).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it("rejects missing headers, excess fields and hostile getters without leaking details", () => {
    const f = fixture();
    const missing = { ...f.signed.headers }; delete missing[H.signature];
    expect(() => f.protocol.verify(f.request(missing))).toThrow(OfficeGatewayError);
    const excess = { ...f.signed.headers, ...Object.fromEntries(Array.from({ length: 129 }, (_, i) => ["other-" + i, "x"])) };
    expect(() => f.protocol.verify(f.request(excess))).toThrow(OfficeGatewayError);
    const getters = { ...f.signed.headers, get [H.signature](): string { throw new Error("secret internal details"); } };
    try { f.protocol.verify(f.request(getters)); } catch (error) {
      expect(error).toMatchObject({ status: 401, code: "OFFICE_GATEWAY_UNAUTHORIZED" });
      expect(String(error)).not.toContain("secret"); expect(error).not.toHaveProperty("cause");
    }
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });
});

describe("time window and bounded single-use nonces", () => {
  it.each([-60_000, 60_000, -60_001, 60_001])("rejects correctly signed out-of-window timestamps without consuming the nonce (%s)", offset => {
    const f = fixture(), headers = resign({ ...f.signed.headers, [H.timestamp]: String(1_000_000 + offset) }, f.signed.body);
    expect(() => f.protocol.verify(f.request(headers))).toThrow(OfficeGatewayError);
    expect(() => f.protocol.verify(f.request())).not.toThrow();
  });

  it.each([-59_999, 59_999])("accepts authenticated skew strictly inside 60 seconds (%s)", offset => {
    const f = fixture(), headers = resign({ ...f.signed.headers, [H.timestamp]: String(1_000_000 + offset) }, f.signed.body);
    expect(() => f.protocol.verify(f.request(headers))).not.toThrow();
    expect(() => f.protocol.verify(f.request(headers))).toThrow(OfficeGatewayError);
  });

  it("rejects replay even if its body/timestamp are signed again with the same nonce", () => {
    const f = fixture(); f.protocol.verify(f.request());
    const body = Buffer.from("different body"), headers = resign(f.signed.headers, body);
    expect(() => f.protocol.verify(f.request(headers, body))).toThrow(OfficeGatewayError);
  });

  it("retains live nonces for two minutes, fails closed at capacity, then frees expired entries", () => {
    const f = fixture("runtime", 1); f.protocol.verify(f.request());
    for (const time of [1_060_001, 1_119_999]) {
      f.time(time); const fresh = f.protocol.sign("{}");
      expect(() => f.protocol.verify(f.request(fresh.headers, fresh.body))).toThrow(OfficeGatewayError);
      try { f.protocol.verify(f.request(fresh.headers, fresh.body)); } catch (error) { expect(error).toMatchObject({ status: 429 }); }
    }
    f.time(1_120_000); const fresh = f.protocol.sign("{}");
    expect(() => f.protocol.verify(f.request(fresh.headers, fresh.body))).not.toThrow();
    expect(() => f.protocol.verify(f.request())).toThrow(OfficeGatewayError); // Expired MAC timestamp cannot become valid through eviction.
  });

  it("does not evict live entries or let invalid authentication fill the replay cache", () => {
    const f = fixture("runtime", 2);
    expect(() => f.protocol.verify(f.request({ ...f.signed.headers, [H.signature]: "0".repeat(64) }))).toThrow(OfficeGatewayError);
    f.protocol.verify(f.request());
    const second = f.protocol.sign("2"); f.protocol.verify(f.request(second.headers, second.body));
    const third = f.protocol.sign("3");
    expect(() => f.protocol.verify(f.request(third.headers, third.body))).toThrow(OfficeGatewayError);
    try { f.protocol.verify(f.request(third.headers, third.body)); } catch (error) { expect(error).toMatchObject({ status: 429 }); }
    expect(() => f.protocol.verify(f.request())).toThrow(OfficeGatewayError);
  });

  it("consumes a valid nonce before handler JSON parsing, including invalid JSON", () => {
    const f = fixture(), invalidJson = f.protocol.sign("{");
    expect(() => f.protocol.verify(f.request(invalidJson.headers, invalidJson.body))).not.toThrow();
    expect(() => JSON.parse(invalidJson.body.toString("utf8"))).toThrow();
    expect(() => f.protocol.verify(f.request(invalidJson.headers, invalidJson.body))).toThrow(OfficeGatewayError);
  });

  it("fails closed for an invalid/throwing clock and can recover without consuming the nonce", () => {
    const f = fixture(); let clock = Number.NaN;
    const verifier = createOfficeGatewayProtocol({ key: KEY, audience: "runtime", now: () => clock });
    expect(() => verifier.verify(f.request())).toThrow(OfficeGatewayError);
    clock = 1_000_000;
    expect(() => verifier.verify(f.request())).not.toThrow();
    const broken = createOfficeGatewayProtocol({ key: KEY, audience: "runtime", now: () => { throw new Error("secret clock"); } });
    expect(() => broken.sign("{}")).toThrow("Office gateway is unavailable");
  });
});
