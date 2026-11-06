/** A gate refusal. `reason` is machine-readable and shown to the user as the "why". */
export class GateError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
