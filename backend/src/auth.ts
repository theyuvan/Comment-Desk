import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { AppError } from "./core.ts";

/** Every write is an EIP-712 signature from the member's wallet. No sessions, no chain ID. */
export const DOMAIN = { name: "Comment Desk", version: "1" } as const;

export const TYPES = {
  Join: [
    { name: "handle", type: "string" },
    { name: "policyVersion", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
  AcceptDocketPolicy: [
    { name: "policyVersion", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
  OpenDocket: [
    { name: "label", type: "string" },
    { name: "title", type: "string" },
    { name: "bodyHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "credentialLevel", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
  SubmitComment: [
    { name: "docket", type: "bytes32" },
    { name: "topic", type: "string" },
    { name: "sentiment", type: "string" },
    { name: "stanceHash", type: "bytes32" },
    { name: "authorType", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
  CloseDocket: [
    { name: "docket", type: "bytes32" },
    { name: "rulingHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
  ModerateDocket: [
    { name: "docket", type: "bytes32" },
    { name: "reason", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
  AttachArchive: [
    { name: "docket", type: "bytes32" },
    { name: "swarmRef", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export type ActionName = keyof typeof TYPES;

const MAX_AGE_MS = 10 * 60 * 1000;

export async function recoverSigner(
  primaryType: ActionName,
  message: Record<string, unknown> & { issuedAt: bigint },
  signature: Hex,
  now = Date.now(),
): Promise<Address> {
  const age = now - Number(message.issuedAt);
  if (age > MAX_AGE_MS || age < -60_000) {
    throw new AppError(401, "signature_stale", "This signature has expired. Sign the request again.");
  }
  try {
    return await recoverTypedDataAddress({
      domain: DOMAIN,
      types: { [primaryType]: TYPES[primaryType] },
      primaryType,
      message,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    throw new AppError(401, "signature_invalid", "That signature could not be verified.");
  }
}
