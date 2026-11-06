import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256B64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Canonical hash of what a comment says and where it goes — the thing a human approves. */
export function draftHash(docketKey: string, topic: string, text: string): string {
  return sha256Hex(JSON.stringify(["commentdesk:draft:v1", docketKey, topic, text]));
}

export const nowSec = () => Math.floor(Date.now() / 1000);
