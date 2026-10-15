export const CLIENT_STATE_LIMITS: Readonly<Record<string, number>>;
export const CLIENT_STATE_KEYS: readonly string[];
export const CLIENT_STATE_MAX_BYTES: number;
export function validateClientStateEntries(entries: unknown): Record<string, string | null>;
export function readClientState(state: Record<string, unknown>, userId: string): Record<string, string>;
export function patchClientState(
  state: Record<string, unknown>, userId: string, body: unknown,
): Record<string, string>;
