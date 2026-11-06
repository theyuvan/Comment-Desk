import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { activity, STEP } from "../src/activity.ts";
import { harness, newWallet, settle } from "./helpers.ts";

const code = (expected: string) => expect.objectContaining({ code: expected });

/** A naming whose member names take as long as the test says. */
function slowNames(context: ReturnType<typeof harness>) {
  let finish!: () => void;
  const minted = new Promise<void>((resolve) => (finish = resolve));
  const register = context.naming.registerMember.bind(context.naming);
  context.naming.registerMember = async (label: string, wallet: Address) => {
    await minted;
    return register(label, wallet);
  };
  return finish;
}

describe("joining without waiting for ENS", () => {
  it("makes the member at once and mints the name behind it", async () => {
    const context = harness();
    const finish = slowNames(context);
    const result = await context.join(newWallet(), "maya");

    expect(result.ensName).toBe("maya.commentdesk.eth");
    expect(context.store.members).toHaveLength(1);
    expect(await context.naming.hasName("maya.commentdesk.eth")).toBe(false);
    expect(context.desk.nameStatus("maya.commentdesk.eth")).toBe("creating");

    finish();
    await settle();
    expect(await context.naming.hasName("maya.commentdesk.eth")).toBe(true);
    expect(context.desk.nameStatus("maya.commentdesk.eth")).toBe("ready");
  });

  it("holds opening a docket until the member's name exists", async () => {
    const context = harness();
    const finish = slowNames(context);
    const wallet = newWallet();
    await context.join(wallet, "maya");
    await context.acceptPolicy(wallet);

    await expect(context.open(wallet)).rejects.toEqual(code("name_pending"));
    finish();
    await settle();
    await expect(context.open(wallet)).resolves.toMatchObject({ ensName: "truck-rule.maya.commentdesk.eth" });
  });

  it("mints the name again if it never landed, e.g. after a restart", async () => {
    const context = harness();
    const wallet = newWallet();
    await context.join(wallet, "maya");
    await context.acceptPolicy(wallet);
    await settle();
    context.naming.wallets.delete("maya.commentdesk.eth");

    await expect(context.open(wallet)).rejects.toEqual(code("name_pending"));
    await settle();
    await expect(context.open(wallet)).resolves.toMatchObject({ ensName: "truck-rule.maya.commentdesk.eth" });
  });

  it("lets a comment made during minting wait for the name instead of failing", async () => {
    const context = harness();
    const { key } = await context.creator(newWallet(), "clerk");
    const finish = slowNames(context);
    const voter = newWallet();
    await context.join(voter, "ravi");

    const posting = context.comment(voter, key, { stance: "Early comment." });
    await settle();
    expect(context.store.comments).toHaveLength(0);
    finish();
    await expect(posting).resolves.toMatchObject({ ensName: expect.stringMatching(/^comment-1\./) });
  });
});

describe("receipts", () => {
  it("records the World check and keeps the join open until its name is minted", async () => {
    const context = harness();
    const finish = slowNames(context);
    await context.join(newWallet(), "asha", "asha-human");

    const [join] = activity.list({ subject: "asha.commentdesk.eth" }).filter((op) => op.kind === "join");
    expect(join.status).toBe("running");
    expect(join.expected).toContain(STEP.registered("asha.commentdesk.eth"));
    expect(join.steps.map((step) => step.label)).toEqual([STEP.worldHuman]);
    expect(join.steps[0]).toMatchObject({ chain: "world", ref: "proof-asha-human" });

    finish();
    await settle();
    expect(activity.list({ subject: "asha.commentdesk.eth" }).find((op) => op.kind === "join")?.status).toBe("done");
  });

  it("names a comment's receipt after the comment, and marks a refused action failed", async () => {
    const context = harness();
    const { key } = await context.creator(newWallet(), "clerk2");
    const voter = newWallet();
    await context.join(voter, "lena");
    const { ensName } = await context.comment(voter, key, { stance: "Yes." });
    await settle();
    expect(activity.list({ subject: ensName })[0]).toMatchObject({ kind: "comment", status: "done" });

    await expect(context.comment(voter, key, { stance: "Again." })).rejects.toEqual(code("already_commented"));
    const refused = activity.list().find((op) => op.kind === "comment" && op.status === "failed");
    expect(refused?.error).toBe("already_commented");
  });
});
