import type { Hex } from "viem";
import type { ArkivStore } from "../arkiv/store.ts";
import type { Desk, VerifiedComment } from "../desk.ts";

/**
 * Implements `WorldGateHost` from shared/src/world-gate.ts on the World branch.
 * World runs every proof check and then calls these three methods, which is the
 * whole join between the two halves. To connect them, replace StubHost with:
 *
 *   host: new DeskWorldHost(desk, store)
 *
 * The types here are structural, so this file needs no dependency on that package.
 */
export class DeskWorldHost {
  constructor(
    private readonly desk: Desk,
    private readonly store: ArkivStore,
  ) {}

  onMemberVerified(proof: { proofRef: string; nullifier: string }, join: { handle: string; wallet?: string }) {
    return this.desk.joinVerified(proof, join);
  }

  async onCommentVerified(proof: { proofRef: string }, submission: VerifiedComment) {
    const { commentRef, ensName } = await this.desk.postVerifiedComment(proof, submission);
    return { commentRef, ensName };
  }

  async getDocket(docketKey: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(docketKey)) return null;
    const docket = await this.store.getDocket(docketKey as Hex);
    if (!docket) return null;
    return {
      key: docket.key,
      title: docket.title,
      topics: docket.topics,
      credentialLevel: docket.credentialLevel === "strict" ? ("strict" as const) : ("soft" as const),
      status: docket.status === "open" ? ("open" as const) : ("closed" as const),
      deadline: Math.floor(Number(docket.deadline) / 1000),
      ensName: docket.ensName,
    };
  }
}
