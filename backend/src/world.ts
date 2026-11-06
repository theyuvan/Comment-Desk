import type { Hex } from "viem";
import { AppError, textHash } from "./core.ts";

/**
 * The one join point with the World integration. Implement WorldGate with
 * IDKit / verifyCloudProof / Agent Pass, and nothing else in this backend
 * needs to change. This code never calls World; that code never touches
 * Arkiv or ENS.
 */

export type CredentialLevel = "proof_of_human" | "proof_of_presence";

export type JoinVerified = {
  humanVerified: true;
  proofRef: string;
  /** Scoped to the join action, so it is the same for one human every time. */
  nullifierHash: string;
};
export type HumanVerified = { humanVerified: true; proofRef: string };
export type AgentConfirmed = { agentConfirmed: true; draftKey: Hex; proofRef: string };

export type WorldDenialReason =
  | "cancelled"
  | "invalid_proof"
  | "nullifier_reused"
  | "confirm_expired"
  | "draft_mismatch";

export class WorldDenied extends AppError {
  constructor(
    readonly reason: WorldDenialReason,
    message: string,
  ) {
    super(403, `world_${reason}`, message);
  }
}

export interface WorldGate {
  /** `signal` is keccak256 of the wallet signature, binding the proof to this join. */
  verifyJoin(input: { proof: unknown; signal: Hex }): Promise<JoinVerified>;
  /** `signal` is the comment's submission key, binding the proof to the exact text. */
  verifyHumanComment(input: {
    proof: unknown;
    signal: Hex;
    credentialLevel: CredentialLevel;
  }): Promise<HumanVerified>;
  /** Must throw draft_mismatch or confirm_expired rather than confirm stale text. */
  verifyAgentConfirm(input: {
    proof: unknown;
    draftKey: Hex;
    credentialLevel: CredentialLevel;
  }): Promise<AgentConfirmed>;
}

/** Refuses everything, so nothing can post until a real gate is installed. */
export const unavailableWorldGate: WorldGate = {
  async verifyJoin() {
    throw new AppError(503, "world_unavailable", "World ID verification is not connected yet.");
  },
  async verifyHumanComment() {
    throw new AppError(503, "world_unavailable", "World ID verification is not connected yet.");
  },
  async verifyAgentConfirm() {
    throw new AppError(503, "world_unavailable", "World Agent Pass is not connected yet.");
  },
};

/**
 * Local integration only, enabled by WORLD_GATE=dev and refused in production.
 * Every proofRef it returns starts with "dev:", and that prefix lands on the
 * public entity, so a dev record can never pass as a verified one.
 */
export const devWorldGate: WorldGate = {
  async verifyJoin({ proof, signal }) {
    const subject = (proof as { subject?: string } | undefined)?.subject ?? signal;
    return {
      humanVerified: true,
      proofRef: `dev:${textHash(subject).slice(2, 42)}`,
      nullifierHash: `dev:${textHash(`nullifier:${subject}`).slice(2, 66)}`,
    };
  },
  async verifyHumanComment({ signal }) {
    return { humanVerified: true, proofRef: `dev:${signal.slice(2, 42)}` };
  },
  async verifyAgentConfirm({ proof, draftKey }) {
    const confirmed = (proof as { draftKey?: Hex } | undefined)?.draftKey ?? draftKey;
    return { agentConfirmed: true, draftKey: confirmed, proofRef: `dev:${draftKey.slice(2, 42)}` };
  },
};
