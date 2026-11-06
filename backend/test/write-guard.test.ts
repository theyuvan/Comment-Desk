import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { WriteGuard } from "../src/arkiv/write-guard.ts";

const opId = `0x${"ab".repeat(32)}` as Hex;
const write = (nonce: number | undefined = 5, at = 0) => ({ opId, kind: "comment", nonce, at });
const chain = (onChain: boolean, latest: number) => ({ isOnChain: async () => onChain, latestNonce: async () => latest });

describe("write guard", () => {
  it("holds nothing until a write is uncertain", () => {
    expect(new WriteGuard().holding).toBe(false);
  });

  it("releases when the entity is found on Arkiv", async () => {
    const guard = new WriteGuard(() => 1000);
    guard.hold(write());
    expect(await guard.settle(chain(true, 5))).toMatchObject([{ outcome: "landed" }]);
    expect(guard.holding).toBe(false);
  });

  it("releases when the signer's nonce moved past the write, for a patch with no op_id", async () => {
    const guard = new WriteGuard(() => 1000);
    guard.hold(write(5));
    expect(await guard.settle(chain(false, 6))).toMatchObject([{ outcome: "landed" }]);
  });

  it("keeps waiting while the write could still land", async () => {
    const guard = new WriteGuard(() => 5000, 90_000);
    guard.hold(write(5));
    expect(await guard.settle(chain(false, 5))).toEqual([]);
    expect(guard.holding).toBe(true);
  });

  it("releases after the settle time if nothing landed", async () => {
    const guard = new WriteGuard(() => 100_000, 90_000);
    guard.hold(write(5));
    expect(await guard.settle(chain(false, 5))).toMatchObject([{ outcome: "never_landed" }]);
    expect(guard.holding).toBe(false);
  });

  it("settles each held write on its own", async () => {
    let time = 1000;
    const guard = new WriteGuard(() => time, 90_000);
    guard.hold(write(5, 0));
    guard.hold({ ...write(7, 500), opId: `0x${"cd".repeat(32)}` as Hex });
    expect(await guard.settle(chain(false, 6))).toHaveLength(1);
    expect(guard.holding).toBe(true);
    time = 100_000;
    expect(await guard.settle(chain(false, 6))).toMatchObject([{ outcome: "never_landed" }]);
  });
});
