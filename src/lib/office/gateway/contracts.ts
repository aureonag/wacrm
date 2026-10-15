import type { OfficeContext } from "../access";
import { canEditSettings, canManageMembers, isAccountRole } from "../../auth/roles";

export const AUREON_OFFICE_ACCOUNT_ID = "737433a3-ec29-4e90-b4ba-9989192ca735";
export const OFFICE_GATEWAY_LIMITS = Object.freeze({
  runtimeRequestBytes: 1024 * 1024,
  runtimeJsonResponseBytes: 16 * 1024 * 1024,
  assetResponseBytes: 64 * 1024 * 1024,
  avatarResponseBytes: 1024 * 1024,
  storeRequestBytes: 16 * 1024 * 1024,
  interfaceBodyBytes: 512 * 1024,
  timeoutMs: 15_000,
});
export type RuntimeOperation =
  | { operation: "bootstrap"; identity: OfficeContext }
  | { operation: "interface"; identity: OfficeContext; method: "GET" | "POST"; endpoint: string; body?: Record<string, unknown>; query?: Record<string, string> }
  | { operation: "asset"; identity: OfficeContext; path: string }
  | { operation: "avatar"; identity: OfficeContext; kind: string; recipe: string };
export type StoreOperation =
  | { operation: "load"; accountId: string }
  | { operation: "compareAndSwap"; accountId: string; expectedRevision: number; nextSnapshot: Record<string, unknown> };

export class OfficeGatewayContractError extends Error {
  readonly code = "OFFICE_GATEWAY_INVALID_REQUEST";
  constructor(readonly status: 400 | 403 | 413 = 400) {
    super(status === 403 ? "Office gateway scope denied" : status === 413 ? "Office gateway payload too large" : "Invalid office gateway request");
    this.name = "OfficeGatewayContractError";
  }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function bad(status: 400 | 403 | 413 = 400): never { throw new OfficeGatewayContractError(status); }
const shape = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) bad();
};
function bounded(value: unknown, maximum: number) {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { bad(); }
  if (encoded === undefined) bad();
  if (Buffer.byteLength(encoded, "utf8") > maximum) bad(413);
}
function account(value: unknown) {
  if (!uuid(value)) bad();
  if (value.toLowerCase() !== AUREON_OFFICE_ACCOUNT_ID) bad(403);
}
function parseIdentity(value: unknown): OfficeContext {
  if (!object(value)) bad();
  shape(value, ["accountId", "user", "role", "capabilities"]);
  account(value.accountId);
  if (!object(value.user) || !object(value.capabilities) || !isAccountRole(value.role)) bad();
  shape(value.user, ["id", "profileId", "name", "avatarUrl"]);
  shape(value.capabilities, ["canDecorate", "canManageMembers"]);
  if (!uuid(value.user.id) || !uuid(value.user.profileId) || typeof value.user.name !== "string" ||
      !value.user.name.trim() || value.user.name.length > 200 || /[\u0000-\u001f]/.test(value.user.name) ||
      !(value.user.avatarUrl === null || typeof value.user.avatarUrl === "string" && value.user.avatarUrl.length <= 2048 && !/[\u0000-\u001f]/.test(value.user.avatarUrl)) ||
      value.capabilities.canDecorate !== canEditSettings(value.role) ||
      value.capabilities.canManageMembers !== canManageMembers(value.role)) bad();
  return structuredClone(value) as unknown as OfficeContext;
}
/** Call only after HMAC verification. This validates a CRM-server DTO, not browser credentials. */
export function parseRuntimeOperation(value: unknown): RuntimeOperation {
  bounded(value, OFFICE_GATEWAY_LIMITS.runtimeRequestBytes);
  if (!object(value)) bad();
  const identity = parseIdentity(value.identity);
  if (value.operation === "bootstrap") shape(value, ["operation", "identity"]);
  else if (value.operation === "interface") {
    shape(value, ["operation", "identity", "method", "endpoint"], ["body", "query"]);
    if ((value.method !== "GET" && value.method !== "POST") || typeof value.endpoint !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.endpoint)) bad();
    if (value.body !== undefined) { if (!object(value.body)) bad(); bounded(value.body, OFFICE_GATEWAY_LIMITS.interfaceBodyBytes); }
    if (value.query !== undefined && (!object(value.query) || Object.keys(value.query).length > 20 ||
        Object.entries(value.query).some(([key, item]) => key.length > 80 || typeof item !== "string" || item.length > 2000))) bad();
  } else if (value.operation === "asset") {
    shape(value, ["operation", "identity", "path"]);
    if (typeof value.path !== "string" || value.path.length > 1024) bad();
  } else if (value.operation === "avatar") {
    shape(value, ["operation", "identity", "kind", "recipe"]);
    if (typeof value.kind !== "string" || value.kind.length > 20 || typeof value.recipe !== "string" || value.recipe.length > 406) bad();
  } else bad();
  return { ...structuredClone(value), identity } as RuntimeOperation;
}
export function parseStoreOperation(value: unknown): StoreOperation {
  bounded(value, OFFICE_GATEWAY_LIMITS.storeRequestBytes);
  if (!object(value)) bad();
  account(value.accountId);
  if (value.operation === "load") shape(value, ["operation", "accountId"]);
  else if (value.operation === "compareAndSwap") {
    shape(value, ["operation", "accountId", "expectedRevision", "nextSnapshot"]);
    if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 ||
        !object(value.nextSnapshot) || value.nextSnapshot.version !== 1 ||
        value.nextSnapshot.accountId !== AUREON_OFFICE_ACCOUNT_ID ||
        value.nextSnapshot.revision !== (value.expectedRevision as number) + 1) bad();
  } else bad();
  return structuredClone(value) as StoreOperation;
}
