import type { Hex } from "viem"
import type { CredentialLevel } from "./api"
import { getWallet } from "./wallet"

export type WorldRequest =
  | { action: "join"; signal: Hex }
  | { action: "human-comment"; signal: Hex; credentialLevel: CredentialLevel }
  | { action: "agent-confirm"; draftKey: Hex; credentialLevel: CredentialLevel }

/**
 * The only place the frontend touches World. Replace the body with IDKit and
 * the Agent Pass confirm, and return the proof for the backend to verify.
 * Throw if the member cancels, and the screens show the message.
 *
 * Until then this returns the shape the backend's WORLD_GATE=dev stand-in takes.
 * A backend with no World gate refuses it, so this cannot post by accident.
 */
export async function getWorldProof(request: WorldRequest): Promise<unknown> {
  if (request.action === "join") return { subject: getWallet().address }
  return {}
}
