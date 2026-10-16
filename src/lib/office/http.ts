import { NextResponse } from "next/server";

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import type { OfficeContext } from "@/lib/office/access";
import { OfficeConfigurationError } from "@/lib/office/access";
import { OfficeGatewayClientError } from "@/lib/office/gateway/client";
import { OfficeRuntimeError } from "@/lib/office/runtime/service.cjs";

export const OFFICE_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export class OfficeHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

export function officeJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: OFFICE_PRIVATE_HEADERS });
}

export function officeError(error: unknown) {
  if (error instanceof UnauthorizedError) return officeJson({ error: "Entre no CRM para continuar.", code: "OFFICE_SESSION_REQUIRED" }, 401);
  if (error instanceof ForbiddenError) return officeJson({ error: "Acesso exclusivo à equipe Aureon.", code: "OFFICE_ACCESS_DENIED" }, 403);
  if (error instanceof OfficeConfigurationError) return officeJson({ error: "O escritório está em preparação." }, 503);
  if (error instanceof OfficeGatewayClientError) return officeJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof OfficeRuntimeError || error instanceof OfficeHttpError) {
    return officeJson({ error: error.message, ...(error instanceof OfficeHttpError && error.code ? { code: error.code } : {}) }, error.status);
  }
  // Do not log database responses, cookies, message contents or request bodies.
  return officeJson({ error: "Não foi possível carregar o escritório." }, 500);
}

function officePublicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured === undefined) {
    // A direct development/test server keeps its existing same-origin contract.
    if (process.env.NODE_ENV !== "production") return new URL(request.url).origin;
    throw new OfficeConfigurationError();
  }
  const value = configured.trim();
  try {
    // Accept only an HTTPS origin and an optional trailing slash. Never derive
    // authorization from client-controlled Host or forwarded proxy headers.
    if (!/^https:\/\/[^/?#@\\\s]+\/?$/.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    // A present but invalid setting never falls back, including in development.
    throw new OfficeConfigurationError();
  }
}

export function requireSameOrigin(request: Request) {
  const expectedOrigin = officePublicOrigin(request);
  if (request.headers.get("origin") !== expectedOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    throw new OfficeHttpError(403, "Reabra o escritório pelo CRM.", "OFFICE_ORIGIN_REJECTED");
  }
}

export async function officeBody(request: Request): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new OfficeHttpError(415, "Envie um conteúdo JSON.");
  }
  const limit = 512 * 1024;
  const announced = Number(request.headers.get("content-length") || "0");
  if (!Number.isSafeInteger(announced) || announced < 0 || announced > limit) {
    throw new OfficeHttpError(413, "O conteúdo excede o tamanho permitido.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new OfficeHttpError(400, "Conteúdo inválido.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new OfficeHttpError(413, "O conteúdo excede o tamanho permitido.");
      }
      chunks.push(chunk.value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Invalid JSON object");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OfficeHttpError) throw error;
    throw new OfficeHttpError(400, "Conteúdo inválido.");
  } finally {
    reader.releaseLock();
  }
}

export function officeQuery(request: Request): Record<string, string> {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (entries.length > 20 || new Set(entries.map(([key]) => key)).size !== entries.length ||
      entries.some(([key, value]) => key.length > 80 || value.length > 2000)) {
    throw new OfficeHttpError(400, "Parâmetros inválidos.");
  }
  return Object.fromEntries(entries);
}

export function requireOfficeIdentity(request: Request, identity: OfficeContext) {
  if (request.headers.get("x-aureon-office-user") !== identity.user.id ||
      request.headers.get("x-aureon-office-account") !== identity.accountId) {
    throw new OfficeHttpError(403, "Sua sessão do escritório foi alterada. Reabra pelo CRM.", "OFFICE_ACCESS_DENIED");
  }
}
