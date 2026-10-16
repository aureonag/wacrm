import type { OfficeContext } from "../access";
import type { OfficeCallConflictCode } from "./call-conflicts.cjs";

export type OfficeSnapshot = Record<string, unknown>;

export interface OfficeRuntimeStore {
  load(accountId: string): Promise<{ revision: number; snapshot: OfficeSnapshot | null }>;
  compareAndSwap(
    accountId: string,
    expectedRevision: number,
    nextSnapshot: OfficeSnapshot,
  ): Promise<boolean>;
}

export interface CrmInterfaceService {
  /** Identity must come from live getOfficeContext(), never request JSON.
   * Only spatial state/control/publish can reuse a committed snapshot.
   * FIFO capacity: 128 requests per account including the active request (429).
   */
  requestAsCrm(
    identity: OfficeContext,
    method: string,
    pathname: string,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export class OfficeRuntimeError extends Error {
  readonly status: number;
  readonly code?: OfficeCallConflictCode;
  constructor(status: number, message: string, code?: unknown);
}

/**
 * Single Node instance pilot. Durable state uses the mandatory injected store.
 * Leases, signals and call sessions reset on restart and require reconnection.
 */
export function createCrmInterfaceService(options: {
  store: OfficeRuntimeStore;
  approvedMap?: Record<string, unknown>;
  now?: () => number;
}): CrmInterfaceService;
