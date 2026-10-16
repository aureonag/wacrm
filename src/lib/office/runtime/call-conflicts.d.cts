export type OfficeCallConflictCode =
  | "OFFICE_CALL_SESSION_REPLACED"
  | "OFFICE_CALL_SESSION_MISSING"
  | "OFFICE_SIGNAL_RECIPIENT_STALE";

export function normalizeOfficeCallConflict(status: unknown, code: unknown): OfficeCallConflictCode | undefined;
export function officeCallConflictMessage(code: unknown): string | undefined;
