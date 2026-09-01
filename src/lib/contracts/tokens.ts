// ============================================================
// Contrato: virtual-acceptance link token utilities.
//
// Same recipe as `src/lib/auth/invitations.ts` — 32 bytes of CSPRNG
// entropy, base64url-encoded for the URL, SHA-256 hashed for storage.
// Kept as its own small module (rather than importing the invitations
// one) since that file's naming/comments are invitation-specific and a
// contract link isn't an invitation.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

/** Default virtual-acceptance link lifetime — confirmed with the user. */
export const CONTRACT_LINK_EXPIRY_DAYS = 7;

export interface GeneratedContractToken {
  /** Plaintext token — embed in the link shown to the agent once, never persist. */
  token: string;
  /** SHA-256 hex digest — persist this in `deal_contracts.token_hash`. */
  hash: string;
}

export function generateContractToken(): GeneratedContractToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashContractToken(token) };
}

export function hashContractToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Builds the public link shown to the agent to copy/send. `baseUrl` must not have a trailing slash (tolerated anyway). */
export function contractSignUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/contracts/${token}`;
}

export function contractExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CONTRACT_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
