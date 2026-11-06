import type { Hex } from "viem";

export type HeldWrite = { opId: Hex; kind: string; nonce?: number; at: number };
export type Settled = HeldWrite & { outcome: "landed" | "never_landed" };

/** Rabdi makes a block every 2s, so a sent transaction lands well inside this. */
const SETTLE_MS = 90_000;

/**
 * After an ambiguous send, the write may or may not have landed, so nothing is
 * resent. New writes wait until the outcome is known, and a network blip clears
 * on its own instead of needing a restart:
 *
 *   landed        its entity is on Arkiv, or the signer's nonce moved past it
 *   never_landed  the settle time passed and the nonce never moved
 *
 * Writes that could repeat are stopped later by their op_id.
 */
export class WriteGuard {
  private held: HeldWrite[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly settleMs = SETTLE_MS,
  ) {}

  hold(write: HeldWrite) {
    this.held.push(write);
  }

  get holding() {
    return this.held.length > 0;
  }

  async settle(chain: { isOnChain: (opId: Hex) => Promise<boolean>; latestNonce: () => Promise<number> }): Promise<Settled[]> {
    const latest = await chain.latestNonce();
    const settled: Settled[] = [];
    const waiting: HeldWrite[] = [];
    for (const write of this.held) {
      if ((await chain.isOnChain(write.opId)) || (write.nonce !== undefined && latest > write.nonce)) {
        settled.push({ ...write, outcome: "landed" });
      } else if (this.now() - write.at >= this.settleMs) {
        settled.push({ ...write, outcome: "never_landed" });
      } else {
        waiting.push(write);
      }
    }
    this.held = waiting;
    return settled;
  }
}
