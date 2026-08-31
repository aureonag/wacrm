/**
 * Thrown by any prospecting tool handler when the model passed an
 * invalid, missing, or out-of-scope argument. Never leaks internal
 * details — `message` is safe to feed back to the model as the tool's
 * error output.
 */
export class ProspectingToolError extends Error {
  readonly code: string;
  constructor(message: string, code = "invalid_argument") {
    super(message);
    this.name = "ProspectingToolError";
    this.code = code;
  }
}
