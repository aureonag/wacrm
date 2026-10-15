import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OfficeGatewayAudience = "runtime" | "store";
export const OFFICE_GATEWAY_PATHS = Object.freeze({
  runtime: "/v1/runtime",
  store: "/api/office/backend-store",
});
export const OFFICE_GATEWAY_BODY_LIMITS = Object.freeze({ runtime: 1024 * 1024, store: 16 * 1024 * 1024 });
export const OFFICE_GATEWAY_HEADERS = Object.freeze({
  version: "x-aureon-office-gateway-version",
  audience: "x-aureon-office-gateway-audience",
  timestamp: "x-aureon-office-gateway-timestamp",
  nonce: "x-aureon-office-gateway-nonce",
  signature: "x-aureon-office-gateway-signature",
});
const WINDOW_MS = 60_000;
const NONCE_TTL_MS = 120_000;
const MAX_REPLAY_ENTRIES = 10_000;

const ERROR_CODES = {
  400: "OFFICE_GATEWAY_INVALID_REQUEST",
  401: "OFFICE_GATEWAY_UNAUTHORIZED",
  413: "OFFICE_GATEWAY_BODY_TOO_LARGE",
  429: "OFFICE_GATEWAY_BUSY",
  503: "OFFICE_GATEWAY_UNAVAILABLE",
} as const;

export class OfficeGatewayError extends Error {
  readonly code: typeof ERROR_CODES[keyof typeof ERROR_CODES];

  constructor(readonly status: 400 | 401 | 413 | 429 | 503) {
    super(status === 503 ? "Office gateway is unavailable" :
      status === 413 ? "Office gateway payload is too large" :
      status === 429 ? "Office gateway is busy" : "Office gateway request could not be verified");
    this.name = "OfficeGatewayError";
    this.code = ERROR_CODES[status];
  }
}

export type OfficeGatewayHeaderInput = Headers |
  Readonly<Record<string, string | readonly string[] | undefined>> |
  ReadonlyArray<readonly [string, string]>;

export interface OfficeGatewayRequest {
  method: string;
  /** Actual request path including any query, which must be rejected. */
  path: string;
  body: Uint8Array;
  headers: OfficeGatewayHeaderInput;
}

export interface OfficeGatewayProtocol {
  /** Serialize JSON once, then send the returned owned bytes without rewriting them. */
  sign(rawBody: Uint8Array | string): { body: Buffer; headers: Record<string, string> };
  /** Consume a nonce once before parsing/dispatching JSON. Never automatically retry. */
  verify(request: OfficeGatewayRequest): void;
}

function unavailable(): never { throw new OfficeGatewayError(503); }
function unauthorized(): never { throw new OfficeGatewayError(401); }

/** Decode only: callers read their separate gateway env. Outer whitespace is trimmed. */
export function decodeOfficeGatewayKey(value: string | undefined): Buffer {
  if (typeof value !== "string") unavailable();
  const hex = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) unavailable();
  return Buffer.from(hex, "hex");
}

function boundedBody(value: Uint8Array | string, limit: number): Buffer {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > limit) throw new OfficeGatewayError(413);
    return Buffer.from(value, "utf8");
  }
  if (!(value instanceof Uint8Array)) throw new OfficeGatewayError(400);
  if (value.byteLength > limit) throw new OfficeGatewayError(413);
  return Buffer.from(value);
}

function signedHeaders(input: OfficeGatewayHeaderInput): Map<string, string> {
  const required = new Set<string>(Object.values(OFFICE_GATEWAY_HEADERS));
  const result = new Map<string, string>();
  let count = 0;
  function add(name: unknown, raw: unknown) {
    if (++count > 128 || typeof name !== "string" || name.length > 256) unauthorized();
    const key = name.toLowerCase();
    if (!required.has(key)) return;
    if (result.has(key)) unauthorized();
    let value: unknown = raw;
    if (Array.isArray(value)) {
      if (value.length !== 1) unauthorized();
      value = value[0];
    }
    if (typeof value !== "string" || !value || value.length > 128 || value.includes(",")) unauthorized();
    result.set(key, value);
  }
  try {
    if (input instanceof Headers) {
      // Headers combines repeated fields with a comma; required values reject it.
      input.forEach((value, name) => add(name, value));
    } else if (Array.isArray(input)) {
      if (input.length > 128) unauthorized();
      for (const entry of input) {
        if (!Array.isArray(entry) || entry.length !== 2) unauthorized();
        add(entry[0], entry[1]);
      }
    } else if (input && typeof input === "object") {
      for (const name in input) {
        if (Object.hasOwn(input, name)) add(name, Reflect.get(input, name));
      }
    } else unauthorized();
  } catch {
    unauthorized();
  }
  if (result.size !== required.size) unauthorized();
  return result;
}

function canonical(audience: OfficeGatewayAudience, timestamp: string, nonce: string, body: Buffer): string {
  // Five ASCII fields, exactly four newlines, no trailing newline; raw bytes are not decoded.
  return ["v1", audience, timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n");
}

/** Pure Node helper. Replay protection is local to this long-lived factory/process. */
export function createOfficeGatewayProtocol({ key, audience, now = Date.now, maxReplayEntries = MAX_REPLAY_ENTRIES }: {
  key: Uint8Array;
  audience: OfficeGatewayAudience;
  now?: () => number;
  maxReplayEntries?: number;
}): OfficeGatewayProtocol {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32 ||
    (audience !== "runtime" && audience !== "store") || typeof now !== "function" ||
    !Number.isSafeInteger(maxReplayEntries) || maxReplayEntries < 1 || maxReplayEntries > MAX_REPLAY_ENTRIES) unavailable();
  const secret = Buffer.from(key);
  const limit = OFFICE_GATEWAY_BODY_LIMITS[audience];
  const consumed = new Map<string, number>();
  function time(): number {
    let value: number;
    try { value = now(); } catch { unavailable(); }
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - NONCE_TTL_MS) unavailable();
    return value;
  }
  function mac(timestamp: string, nonce: string, body: Buffer): Buffer {
    return createHmac("sha256", secret).update(canonical(audience, timestamp, nonce, body), "utf8").digest();
  }
  return {
    sign(rawBody) {
      const body = boundedBody(rawBody, limit), timestamp = String(time()), nonce = randomBytes(16).toString("hex");
      return { body, headers: {
        [OFFICE_GATEWAY_HEADERS.version]: "v1",
        [OFFICE_GATEWAY_HEADERS.audience]: audience,
        [OFFICE_GATEWAY_HEADERS.timestamp]: timestamp,
        [OFFICE_GATEWAY_HEADERS.nonce]: nonce,
        [OFFICE_GATEWAY_HEADERS.signature]: mac(timestamp, nonce, body).toString("hex"),
      } };
    },
    verify(request) {
      if (!request || request.method !== "POST" || request.path !== OFFICE_GATEWAY_PATHS[audience]) {
        throw new OfficeGatewayError(400);
      }
      if (!(request.body instanceof Uint8Array)) throw new OfficeGatewayError(400);
      // The transport must also bound streaming reads before passing the owned body here.
      const body = boundedBody(request.body, limit);
      const headers = signedHeaders(request.headers);
      if (headers.get(OFFICE_GATEWAY_HEADERS.version) !== "v1" || headers.get(OFFICE_GATEWAY_HEADERS.audience) !== audience) unauthorized();
      const timestamp = headers.get(OFFICE_GATEWAY_HEADERS.timestamp)!;
      const nonce = headers.get(OFFICE_GATEWAY_HEADERS.nonce)!;
      const signature = headers.get(OFFICE_GATEWAY_HEADERS.signature)!;
      if (!/^(0|[1-9][0-9]{0,15})$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) ||
        !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) unauthorized();
      const current = time();
      // Strict bound ensures a 120-second nonce TTL covers the entire +/-60s window.
      if (Math.abs(current - Number(timestamp)) >= WINDOW_MS) unauthorized();
      const supplied = Buffer.from(signature, "hex"), expected = mac(timestamp, nonce, body);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) unauthorized();
      // Only a fully authenticated, bounded request can change replay state.
      for (const [prior, expires] of consumed) if (expires <= current) consumed.delete(prior);
      if (consumed.has(nonce)) unauthorized();
      // Fail closed. Never evict an unexpired nonce to make room for another request.
      if (consumed.size >= maxReplayEntries) throw new OfficeGatewayError(429);
      consumed.set(nonce, current + NONCE_TTL_MS);
    },
  };
}
