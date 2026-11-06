import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, harness, newWallet, settle } from "./helpers.ts";
import { AppError, opId, ownerHash, textHash } from "../src/core.ts";
import { submissionKey } from "../src/desk.ts";
import { WorldDenied } from "../src/world.ts";

const code = (expected: string) => expect.objectContaining({ code: expected });

afterEach(() => vi.useRealTimers());

describe("joining", () => {
  it("gives a verified human one ENS name and one member entity", async () => {
    const { store, naming, join } = harness();
    const result = await join(newWallet(), "maya");
    expect(result.ensName).toBe("maya.commentdesk.eth");
    expect(store.members).toHaveLength(1);
    expect(store.policies.map((policy) => policy.policy)).toEqual(["join"]);
    expect(naming.calls).toEqual(["member:maya"]);
  });

  it("refuses a second identity for the same human, even from a new wallet", async () => {
    const { store, join } = harness();
    await join(newWallet(), "maya", "same-person");
    await expect(join(newWallet(), "maya2", "same-person")).rejects.toEqual(code("human_already_joined"));
    expect(store.members).toHaveLength(1);
  });

  it("refuses a second join from the same wallet", async () => {
    const { join } = harness();
    const wallet = newWallet();
    await join(wallet, "maya");
    await expect(join(wallet, "maya-two", "other")).rejects.toEqual(code("already_member"));
  });

  it("refuses a taken handle", async () => {
    const { join } = harness();
    await join(newWallet(), "maya");
    await expect(join(newWallet(), "maya", "other")).rejects.toEqual(code("handle_taken"));
  });

  it("only one of two simultaneous joins by one human succeeds", async () => {
    const { store, join } = harness();
    const results = await Promise.allSettled([
      join(newWallet(), "first", "same-person"),
      join(newWallet(), "second", "same-person"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(store.members).toHaveLength(1);
  });

  it("writes nothing when World denies the proof", async () => {
    const { store, naming, world, join } = harness();
    world.deny = new WorldDenied("cancelled", "Verification was cancelled.");
    await expect(join(newWallet(), "maya")).rejects.toEqual(code("world_cancelled"));
    expect(store.members).toHaveLength(0);
    expect(store.policies).toHaveLength(0);
    expect(naming.calls).toEqual([]);
  });

  it("rejects reserved and malformed handles", async () => {
    const { join } = harness();
    await expect(join(newWallet(), "agent")).rejects.toEqual(code("invalid_label"));
    await expect(join(newWallet(), "-bad-")).rejects.toEqual(code("invalid_label"));
  });

  it("rejects a stale signature", async () => {
    const { desk } = harness();
    const wallet = newWallet();
    const issuedAt = BigInt(Date.now() - 3_600_000);
    const signature = await sign(wallet, "Join", { handle: "maya", policyVersion: "1", issuedAt });
    await expect(desk.join({ handle: "maya", issuedAt, signature, proof: { human: "a" } })).rejects.toEqual(
      code("signature_stale"),
    );
  });
});

describe("opening a docket", () => {
  it("blocks a member without the docket-creation policy, with a clear reason", async () => {
    const { store, join, open } = harness();
    const wallet = newWallet();
    await join(wallet, "maya");
    await expect(open(wallet)).rejects.toEqual(code("docket_policy_required"));
    expect(store.dockets).toHaveLength(0);
  });

  it("treats join and docket-creation as two distinct consents", async () => {
    const { store, creator } = harness();
    await creator(newWallet());
    expect(store.policies.map((policy) => policy.policy)).toEqual(["join", "docket-creation"]);
  });

  it("nests the docket under its creator and links its ENS record", async () => {
    const { naming, creator } = harness();
    const { ensName } = await creator(newWallet());
    await settle();
    expect(ensName).toBe("truck-rule.maya.commentdesk.eth");
    expect(naming.calls).toContain("docket:truck-rule");
    expect(naming.calls).toContain(`link:${ensName}`);
  });

  it("refuses a deadline past what Arkiv can keep alive", async () => {
    const { open, join, acceptPolicy } = harness();
    const wallet = newWallet();
    await join(wallet, "maya");
    await acceptPolicy(wallet);
    await expect(open(wallet, "too-long", BigInt(Date.now() + 200 * 86_400_000))).rejects.toEqual(code("invalid_input"));
  });

  it("refuses a visitor", async () => {
    const { open } = harness();
    await expect(open(newWallet())).rejects.toEqual(code("not_a_member"));
  });
});

describe("commenting", () => {
  async function ready() {
    const context = harness();
    const owner = newWallet();
    const { key } = await context.creator(owner);
    const voter = newWallet();
    await context.join(voter, "ravi");
    return { ...context, docket: key, voter };
  }

  it("posts a human comment through the IDKit gate", async () => {
    const { store, naming, comment, docket, voter } = await ready();
    const result = await comment(voter, docket);
    await settle();
    expect(result).toMatchObject({ counted: true, ensName: "comment-1.truck-rule.maya.commentdesk.eth" });
    expect(store.comments[0]).toMatchObject({ authorType: "human", authorEns: "ravi.commentdesk.eth", ordinal: 1 });
    expect(naming.calls).toContain(`comment:${result.ensName}`);
  });

  it("posts an agent comment through Agent Pass under the agent's own name", async () => {
    const { store, naming, comment, docket, voter } = await ready();
    await comment(voter, docket, { authorType: "agent" });
    await settle();
    expect(store.comments[0]).toMatchObject({
      authorType: "agent",
      authorEns: "agent.ravi.commentdesk.eth",
      proofRef: expect.stringContaining("agent-proof"),
    });
    expect(naming.calls).toContain("agent:ravi.commentdesk.eth");
  });

  it("discards an agent draft when the confirm covers different text", async () => {
    const { store, world, comment, docket, voter } = await ready();
    world.confirmedDraft = opId("the text that was actually approved");
    await expect(comment(voter, docket, { authorType: "agent", stance: "changed after approval" })).rejects.toEqual(
      code("world_draft_mismatch"),
    );
    expect(store.comments).toHaveLength(0);
  });

  it("posts nothing when the Agent Pass confirm expired", async () => {
    const { store, world, comment, docket, voter } = await ready();
    world.deny = new WorldDenied("confirm_expired", "This approval expired.");
    await expect(comment(voter, docket, { authorType: "agent" })).rejects.toEqual(code("world_confirm_expired"));
    expect(store.comments).toHaveLength(0);
  });

  it("posts nothing when the member cancels IDKit", async () => {
    const { store, world, comment, docket, voter } = await ready();
    world.deny = new WorldDenied("cancelled", "Cancelled.");
    await expect(comment(voter, docket)).rejects.toEqual(code("world_cancelled"));
    expect(store.comments).toHaveLength(0);
  });

  it("binds the proof to the exact text, topic and author", async () => {
    const { store, world, comment, docket, voter } = await ready();
    await comment(voter, docket, { stance: "Exact words." });
    expect(world.received[0]).toBe(
      submissionKey({
        docket,
        topic: "emissions",
        sentiment: "support",
        stanceHash: textHash("Exact words."),
        authorType: "human",
        owner: ownerHash(voter.address),
      }),
    );
    await comment(voter, docket, { stance: "Exact words!" });
    expect(world.received[1]).not.toBe(world.received[0]);
    expect(store.comments).toHaveLength(2);
  });

  it("stores extras but only counts the first, then hits the cap", async () => {
    const { store, comment, docket, voter } = await ready();
    expect((await comment(voter, docket)).counted).toBe(true);
    expect((await comment(voter, docket)).counted).toBe(false);
    expect((await comment(voter, docket)).counted).toBe(false);
    await expect(comment(voter, docket)).rejects.toEqual(code("comment_cap_reached"));
    expect(store.comments).toHaveLength(3);
  });

  it("counts one comment per topic, not per docket", async () => {
    const { comment, docket, voter } = await ready();
    expect((await comment(voter, docket, { topic: "emissions" })).counted).toBe(true);
    expect((await comment(voter, docket, { topic: "cost" })).counted).toBe(true);
  });

  it("does not spend a World proof on a comment that cannot post", async () => {
    const { world, comment, docket, voter } = await ready();
    await expect(comment(voter, docket, { topic: "unknown" })).rejects.toEqual(code("unknown_topic"));
    await expect(comment(newWallet(), docket)).rejects.toEqual(code("not_a_member"));
    expect(world.received).toHaveLength(0);
  });

  it("gives every comment a unique name under concurrency", async () => {
    const { store, join, comment, docket } = await ready();
    const voters = [newWallet(), newWallet(), newWallet(), newWallet()];
    await Promise.all(voters.map((wallet, index) => join(wallet, `voter-${index}`)));
    await Promise.all(voters.map((wallet) => comment(wallet, docket)));
    expect(new Set(store.comments.map((item) => item.ensName)).size).toBe(4);
  });

  it("returns the same comment for a replayed request", async () => {
    const { store, desk, docket, voter } = await ready();
    const issuedAt = BigInt(Date.now());
    const message = {
      docket,
      topic: "cost",
      sentiment: "oppose",
      stanceHash: textHash("Once."),
      authorType: "human",
      issuedAt,
    };
    const signature = await sign(voter, "SubmitComment", message);
    const request = { docket, topic: "cost", sentiment: "oppose", stance: "Once.", authorType: "human" as const, issuedAt, signature, proof: {} };
    const first = await desk.submitComment(request);
    const second = await desk.submitComment(request);
    expect(second).toMatchObject({ key: first.key, repeated: true });
    expect(store.comments).toHaveLength(1);
  });

  it("refuses comments after the deadline", async () => {
    const { comment, docket, voter } = await ready();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    await expect(comment(voter, docket)).rejects.toEqual(code("docket_closed"));
  });
});

describe("concluding a docket", () => {
  async function ready(options: Parameters<typeof harness>[0] = {}) {
    const context = harness(options);
    const owner = newWallet();
    const { key } = await context.creator(owner);
    const close = async (wallet = owner, ruling = "The rule passes.") => {
      const issuedAt = BigInt(Date.now());
      const signature = await sign(wallet, "CloseDocket", { docket: key, rulingHash: textHash(ruling), issuedAt });
      return context.desk.closeDocket({ docket: key, ruling, issuedAt, signature });
    };
    const attach = async (swarmRef: string, wallet = owner) => {
      const issuedAt = BigInt(Date.now());
      const signature = await sign(wallet, "AttachArchive", { docket: key, swarmRef, issuedAt });
      return context.desk.attachArchive({ docket: key, swarmRef, issuedAt, signature });
    };
    return { ...context, owner, docket: key, close, attach };
  }
  const afterDeadline = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
  };

  it("waits for the deadline", async () => {
    const { close } = await ready();
    await expect(close()).rejects.toEqual(code("deadline_not_reached"));
  });

  it("only the creator can publish the ruling", async () => {
    const { close } = await ready();
    afterDeadline();
    await expect(close(newWallet())).rejects.toEqual(code("not_docket_creator"));
  });

  it("publishes the ruling to Arkiv and the status to ENS", async () => {
    const { store, naming, close } = await ready();
    afterDeadline();
    await close();
    await settle();
    expect(store.dockets[0]).toMatchObject({ status: "closed", ruling: "The rule passes." });
    expect(naming.calls.some((call) => call.endsWith(":closed:operator"))).toBe(true);
  });

  it("lets only moderators close early, through the moderator's scoped role", async () => {
    const moderator = newWallet();
    const { store, naming, desk, docket } = await ready({ moderators: [moderator.address.toLowerCase() as `0x${string}`] });
    const moderate = async (wallet: typeof moderator) => {
      const issuedAt = BigInt(Date.now());
      const signature = await sign(wallet, "ModerateDocket", { docket, reason: "Spam", issuedAt });
      return desk.moderateDocket({ docket, reason: "Spam", issuedAt, signature });
    };
    await expect(moderate(newWallet())).rejects.toEqual(code("not_a_moderator"));
    await moderate(moderator);
    await settle();
    expect(store.dockets[0]?.status).toBe("closed-for-cause");
    expect(naming.calls.some((call) => call.endsWith(":closed-for-cause:moderator"))).toBe(true);
  });

  it("refuses an encrypted Swarm reference, because it contains its key", async () => {
    const { close, attach } = await ready();
    afterDeadline();
    await close();
    await expect(attach("ab".repeat(64))).rejects.toEqual(code("invalid_swarm_ref"));
  });

  it("records the Swarm reference on Arkiv and ENS once closed", async () => {
    const { store, naming, close, attach, desk, docket } = await ready();
    const swarmRef = "ab".repeat(32);
    await expect(attach(swarmRef)).rejects.toEqual(code("docket_open"));
    afterDeadline();
    await close();
    await attach(swarmRef);
    await settle();
    expect(store.dockets[0]?.swarmRef).toBe(swarmRef);
    expect(naming.calls.some((call) => call.includes(`archive:`))).toBe(true);
    expect((await desk.archive(docket)).ruling).toBe("The rule passes.");
  });
});

describe("privacy (FR10, NFR1)", () => {
  it("keeps raw wallets and raw signatures out of every stored record", async () => {
    const { store, creator, join, comment } = harness();
    const owner = newWallet();
    const voter = newWallet();
    const { key } = await creator(owner);
    await join(voter, "ravi");
    await comment(voter, key);
    await comment(voter, key, { authorType: "agent", topic: "cost" });

    const everything = JSON.stringify(
      [store.members, store.policies, store.dockets, store.comments],
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    ).toLowerCase();
    for (const wallet of [owner, voter]) {
      expect(everything).not.toContain(wallet.address.toLowerCase());
      expect(everything).not.toContain(wallet.address.toLowerCase().slice(2));
    }
    expect(everything).not.toMatch(/0x[0-9a-f]{130}/);
  });
});

describe("failure surfaces", () => {
  it("reports a denied write through the failing call, never silently", async () => {
    const { desk } = harness();
    const wallet = newWallet();
    const issuedAt = BigInt(Date.now());
    const signature = await sign(wallet, "AcceptDocketPolicy", { policyVersion: "1", issuedAt });
    await expect(desk.acceptDocketPolicy({ issuedAt, signature })).rejects.toBeInstanceOf(AppError);
  });
});
