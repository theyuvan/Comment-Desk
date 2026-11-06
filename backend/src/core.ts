import { keccak256, stringToHex, type Address, type Hex } from "viem";

/** An error safe to show a client. `code` is stable for the frontend to branch on. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * FR10: entities hold this, never the raw wallet. Domain-separated so the value
 * cannot be matched against a generic table of address hashes.
 */
export function ownerHash(wallet: Address): Hex {
  return keccak256(stringToHex(`commentdesk:v1:${wallet.toLowerCase()}`));
}

export function textHash(text: string): Hex {
  return keccak256(stringToHex(text));
}

/** Stable identity for a write, stored on the entity so retries can find it. */
export function opId(...parts: (string | number)[]): Hex {
  return keccak256(stringToHex(parts.join("|")));
}

/** Runs tasks one at a time, in order. A failed task does not stop the next. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => {});
    return result;
  }
}
