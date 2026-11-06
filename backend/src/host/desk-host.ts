import type { Hex } from "viem";
import type { ArkivStore } from "../arkiv/store.ts";
import type { Desk, VerifiedComment } from "../desk.ts";

/**
 * Implements `WorldGateHost` from shared/src/world-gate.ts: the whole join between the
 * World gates and Arkiv/ENS. World runs every proof check and then calls these three methods.
 *
 * The types here are structural, so this file needs no dependency on that package.
 */
export class DeskWorldHost {
  constructor(
    private readonly desk: Desk,
    private readonly store: ArkivStore,
  ) {}

  async onMemberVerified(proof: { proofRef: string; nullifier: string }, join: { handle: string; wallet?: string }) {
    // The join nullifier is one per human. If Arkiv already has it, the World gate's own
    // record was lost (fresh data dir, new deploy): sign the same human back in, mint nothing.
    const existing = await this.store.findMemberByNullifier(proof.nullifier);
    if (existing) return { memberRef: existing.key, ensName: existing.ensName, returning: true };
    return this.desk.joinVerified(proof, join);
  }

  async onCommentVerified(proof: { proofRef: string }, submission: VerifiedComment) {
    const { commentRef, ensName } = await this.desk.postVerifiedComment(proof, submission);
    return { commentRef, ensName };
  }

  async getInsight(docketKey: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(docketKey)) return null;
    const { tally } = await this.desk.tally(docketKey as Hex);
    return {
      counted: tally.counted,
      topics: tally.topics.map(({ topic, support, oppose, neutral, human, agent }) => ({ topic, support, oppose, neutral, human, agent })),
    };
  }

  async getDocket(docketKey: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(docketKey)) return null;
    const docket = await this.store.getDocket(docketKey as Hex);
    if (!docket) return null;
    return {
      key: docket.key,
      title: docket.title,
      question: docket.question,
      topics: docket.topics,
      credentialLevel: docket.credentialLevel === "strict" ? ("strict" as const) : ("soft" as const),
      status: docket.status === "open" ? ("open" as const) : ("closed" as const),
      deadline: Math.floor(Number(docket.deadline) / 1000),
      ensName: docket.ensName,
    };
  }
}
