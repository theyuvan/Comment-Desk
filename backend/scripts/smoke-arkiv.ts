/**
 * Real write-and-read test on Rabdi: creates one short-lived entity of each
 * schema, reads them back through the store, patches the docket, and recounts
 * through the public path. Costs a little test GLM.
 *
 *   npm run smoke:arkiv
 */
import { join } from "node:path";
import { formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LiveArkivStore } from "../src/arkiv/store.ts";
import { ArkivWriter } from "../src/arkiv/writer.ts";
import { loadConfig } from "../src/config.ts";
import { opId, ownerHash, textHash } from "../src/core.ts";
import { recountFromArkiv } from "../src/recount-client.ts";

const config = loadConfig();
const account = privateKeyToAccount(config.ARKIV_PRIVATE_KEY);
const writer = new ArkivWriter({
  account,
  accessKey: config.ARKIV_ACCESS_KEY,
  maxFeeWei: config.ARKIV_MAX_FEE_WEI,
  journalPath: join(config.DATA_DIR, "smoke-journal.jsonl"),
});
const store = new LiveArkivStore(writer);

const run = Date.now();
const member = ownerHash(account.address);
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
};
/** Queries can lag a confirmed write by a block. */
async function settled<T>(read: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return undefined;
}

console.log(`Publisher ${account.address}`);
console.log(`Balance ${formatEther(await writer.reader.getBalance({ address: account.address }))} GLM`);

const policyKey = await store.createPolicy({
  opId: opId("smoke-policy", run),
  ownerHash: member,
  policy: "join",
  policyVersion: "smoke",
  signatureHash: textHash("smoke"),
  acceptedAt: BigInt(run),
});
console.log(`policy_acceptance ${policyKey}`);
check("policy reads back", Boolean(await settled(() => store.findPolicy(member, "join"))));

const ensName = `smoke-${run}.example.eth`;
const memberKey = await store.createMember({
  opId: opId("smoke-member", run),
  ownerHash: member,
  nullifierHash: `smoke:${run}`,
  ensName,
  proofRef: "dev:smoke",
  joinPolicyKey: policyKey,
  joinedAt: BigInt(run),
});
console.log(`member ${memberKey}`);
const foundMember = await settled(() => store.findMemberByEns(ensName));
check("member reads back by ENS name", foundMember?.key === memberKey);
check("member finds by nullifier", (await store.findMemberByNullifier(`smoke:${run}`))?.key === memberKey);

const docketKey = await store.createDocket({
  opId: opId("smoke-docket", run),
  ownerHash: member,
  ensName: `docket-${ensName}`,
  status: "open",
  credentialLevel: "proof_of_presence",
  deadline: BigInt(run + 3_600_000),
  createdAt: BigInt(run),
  title: "Smoke docket",
  question: "Does the full path work?",
  topics: ["alpha", "beta"],
  expiresOn: new Date(run + 86_400_000),
});
console.log(`docket ${docketKey}`);
const docket = await settled(() => store.getDocket(docketKey));
check("docket reads back with topics", docket?.topics.join() === "alpha,beta");
if (!docket) throw new Error("Docket did not read back");

const comment = (n: number, sentiment: string, owner: string) =>
  store.createComment({
    opId: opId("smoke-comment", run, n),
    docketKey: docket.key,
    topic: "alpha",
    ownerHash: owner,
    authorType: "human",
    sentiment,
    submittedAt: BigInt(run + n),
    ensName: `comment-${n}.smoke.eth`,
    authorEns: ensName,
    proofRef: "dev:smoke",
    ordinal: n,
    stanceHash: textHash("hello ✓"),
    stance: "hello ✓",
    expiresAtBlock: docket.expiresAt,
  });

const first = await comment(1, "support", member);
const duplicate = await comment(2, "oppose", member);
console.log(`comments ${first} ${duplicate}`);

const comments = (await settled(async () => {
  const list = await store.listComments(docket.key);
  return list.length >= 2 ? list : undefined;
})) as Awaited<ReturnType<typeof store.listComments>>;
check("comments list and decode text", comments?.[0]?.stance === "hello ✓");
check("count matches", (await store.countComments(docket.key)) === 2);
check("member count matches", (await store.countMemberComments(docket.key, member, "alpha")) === 2);

await store.patchDocket(docket.key, {
  opId: opId("smoke-patch", run),
  status: "closed",
  ruling: "Smoke ruling",
  rulingHash: textHash("Smoke ruling"),
  closedAt: BigInt(Date.now()),
});
const closed = await settled(async () => {
  const value = await store.getDocket(docket.key);
  return value?.status === "closed" ? value : undefined;
});
check("docket patches and reads back the ruling", closed?.ruling === "Smoke ruling");

const recount = await recountFromArkiv({
  docketKey: docket.key,
  publisher: account.address,
  accessKey: config.ARKIV_ACCESS_KEY,
});
check("public recount counts one, ignores the duplicate", recount.tally.counted === 1 && recount.tally.ignored.duplicate === 1);

const expired = await writer.reader
  .getEntity(first as Hex)
  .then((entity) => entity.$expiresAt === docket.expiresAt)
  .catch(() => false);
check("comment expires at the docket's block", expired);

console.log("\nExplorer: https://rabdi.explorer.arkiv.network/entity-explorer");
console.log(`Try the keyless recount: npx tsx scripts/recount.ts ${docket.key} ${account.address}`);
