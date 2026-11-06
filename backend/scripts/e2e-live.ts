/**
 * The whole journey on real networks, through the real API. Needs the server
 * running with WORLD_GATE=dev. World is the only stand-in: records it writes
 * carry a dev: proof reference.
 *
 *   npx tsx --env-file=.env scripts/e2e-live.ts
 */
import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, stringToHex, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DOMAIN, TYPES, type ActionName } from "../src/auth.ts";
import { SEPOLIA, TEXT_KEYS, universalHelperAbi, userRegistryAbi, resolverAbi } from "../src/ens/constants.ts";
import { dnsEncode, registrySalt } from "../src/ens/names.ts";

const API = process.env.E2E_API ?? "http://localhost:8787";
const run = Date.now().toString(36);
const creator = privateKeyToAccount(generatePrivateKey());
const voter = privateKeyToAccount(generatePrivateKey());
type Account = typeof creator;
let failed = 0;

const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};
const step = (label: string) => console.log(`\n== ${label}`);
const hash = (text: string) => keccak256(stringToHex(text));
const stringify = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const sign = (account: Account, primaryType: ActionName, message: Record<string, unknown>) =>
  account.signTypedData({ domain: DOMAIN, types: { [primaryType]: TYPES[primaryType] }, primaryType, message } as never);

async function join(account: Account, handle: string, subject: string) {
  const issuedAt = BigInt(Date.now());
  const signature = await sign(account, "Join", { handle, policyVersion: "1", issuedAt });
  return call("POST", "/api/members", { handle, issuedAt, signature, worldProof: { subject } });
}

async function comment(account: Account, docket: Hex, stance: string, authorType: "human" | "agent", topic: string, proof: object = {}) {
  const issuedAt = BigInt(Date.now());
  const sentiment = authorType === "human" ? "support" : "oppose";
  const signature = await sign(account, "SubmitComment", {
    docket, topic, sentiment, stanceHash: hash(stance), authorType, issuedAt,
  });
  return call("POST", `/api/dockets/${docket}/comments`, {
    topic, sentiment, stance, authorType, issuedAt, signature, worldProof: proof,
  });
}

async function openDocket(account: Account, label: string, deadline: bigint) {
  const issuedAt = BigInt(Date.now());
  const title = "Should the city adopt the truck emissions rule?";
  const question = "The city proposes stricter limits on diesel trucks from 2027. Comment on each topic.";
  const topics = ["emissions", "cost"];
  const credentialLevel = "proof_of_presence";
  const signature = await sign(account, "OpenDocket", {
    label, title, bodyHash: hash(JSON.stringify({ question, topics })), deadline, credentialLevel, issuedAt,
  });
  return call("POST", "/api/dockets", { label, title, question, topics, deadline, credentialLevel, issuedAt, signature });
}

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
});
const text = (name: string, key: string) =>
  client.getEnsText({ name, key, universalResolverAddress: SEPOLIA.universalResolver }).catch(() => null);
const addressOf = (name: string) =>
  client.getEnsAddress({ name, universalResolverAddress: SEPOLIA.universalResolver }).catch(() => null);

async function until<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, seconds = 180): Promise<T> {
  const stop = Date.now() + seconds * 1000;
  let value = await read();
  while (!done(value) && Date.now() < stop) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    value = await read();
  }
  check(label, done(value));
  return value;
}

step("Join (World ID stand-in, real ENS and Arkiv)");
const creatorHandle = `maya-${run}`;
const voterHandle = `ravi-${run}`;
const joined = await join(creator, creatorHandle, `human-a-${run}`);
check("creator joins", joined.status === 201, joined.body.ensName);
const memberName = joined.body.ensName as string;
const joinedVoter = await join(voter, voterHandle, `human-b-${run}`);
check("voter joins", joinedVoter.status === 201, joinedVoter.body.ensName);
check("member name resolves to their wallet", (await addressOf(memberName))?.toLowerCase() === creator.address.toLowerCase());
const sybil = await join(privateKeyToAccount(generatePrivateKey()), `sybil-${run}`, `human-a-${run}`);
check("same human, new wallet is refused", sybil.body.error === "human_already_joined");

step("Open a docket (real ENS resolver and EAC roles)");
const blocked = await openDocket(creator, `early-${run}`, BigInt(Date.now() + 3_600_000));
check("blocked without the creator policy", blocked.body.error === "docket_policy_required");
const policyAt = BigInt(Date.now());
const accepted = await call("POST", "/api/policies/docket-creation", {
  issuedAt: policyAt,
  signature: await sign(creator, "AcceptDocketPolicy", { policyVersion: "1", issuedAt: policyAt }),
});
check("creator policy signed", accepted.status === 201, accepted.body.key);
await new Promise((resolve) => setTimeout(resolve, 4000));
const deadline = BigInt(Date.now() + 240_000);
const opened = await openDocket(creator, "truck-rule", deadline);
check("docket opens", opened.status === 201, stringify(opened.body));
const docket = opened.body.key as Hex;
const docketName = opened.body.ensName as string;
check("docket status resolves on ENS", (await text(docketName, TEXT_KEYS.status)) === "open");
await new Promise((resolve) => setTimeout(resolve, 4000));

step("Comments through both gates");
const human = await comment(voter, docket, "Cleaner air is worth the transition cost.", "human", "emissions");
check("human comment posts", human.status === 201 && human.body.counted === true, human.body.ensName);
const agent = await comment(voter, docket, "My agent drafted this: phase it in over three years.", "agent", "cost");
check("agent comment posts", agent.status === 201, agent.body.ensName);
await new Promise((resolve) => setTimeout(resolve, 4000));
const extra = await comment(voter, docket, "A second thought on emissions.", "human", "emissions");
check("second comment on a topic stores but does not count", extra.status === 201 && extra.body.counted === false);
const mismatch = await comment(voter, docket, "Text the human never approved.", "agent", "emissions", { draftKey: hash("what was really approved") });
check("changed agent draft is discarded", mismatch.body.error === "world_draft_mismatch");

step("ENS names for comments");
const commentName = human.body.ensName as string;
await until("comment resolves to its Arkiv entity", () => text(commentName, TEXT_KEYS.arkivKey), (value) => value === human.body.key, 240);
check("comment names its author", (await text(commentName, TEXT_KEYS.author)) === `${voterHandle}.commentdesk.eth`);
await until("agent has its own name", () => addressOf(`agent.${voterHandle}.commentdesk.eth`), (value) => value?.toLowerCase() === voter.address.toLowerCase(), 240);
await until("agent comment names the agent", () => text(agent.body.ensName, TEXT_KEYS.author), (value) => value === `agent.${voterHandle}.commentdesk.eth`, 240);

step("Live tally");
const tally = await until("tally counts 2 of 3 stored", () => call("GET", `/api/dockets/${docket}/tally`), (value) => value.body.counted === 2 && value.body.stored === 3, 60);
console.log(stringify(tally.body.topics));

step("Field-scoped moderation on live contracts");
const moderatorKey = process.env.ENS_MODERATOR_PRIVATE_KEY as Hex;
const operatorKey = process.env.ENS_OPERATOR_PRIVATE_KEY as Hex;
const memberRegistry = (await client.readContract({
  address: SEPOLIA.verifiableFactory,
  abi: parseAbi(["function predictProxyAddress(address deployer, uint256 salt) view returns (address)"]),
  functionName: "predictProxyAddress",
  args: [privateKeyToAccount(operatorKey).address, registrySalt(memberName)],
})) as Address;
const docketResolver = (await client.readContract({
  address: memberRegistry, abi: userRegistryAbi as Abi, functionName: "getResolver", args: ["truck-rule"],
})) as Address;
console.log(`docket resolver ${docketResolver}`);
const attempt = (account: Address, key: string, value: string) =>
  client
    .call({
      account,
      to: docketResolver,
      data: encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(docketName), key, value] }),
    })
    .then(() => true)
    .catch(() => false);
const moderator = privateKeyToAccount(moderatorKey).address;
const operator = privateKeyToAccount(operatorKey).address;
check("moderator may edit status", await attempt(moderator, TEXT_KEYS.status, "closed-for-cause"));
check("moderator may not edit the title", !(await attempt(moderator, TEXT_KEYS.title, "hijacked")));
check("operator may not edit the title", !(await attempt(operator, TEXT_KEYS.title, "hijacked")));
check("creator may edit the title", await attempt(creator.address, TEXT_KEYS.title, "their own record"));

const attemptOn = (account: Address, name: string, key: string) =>
  client
    .call({
      account,
      to: docketResolver,
      data: encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(name), key, "x"] }),
    })
    .then(() => true)
    .catch(() => false);
check("creator may not rewrite a comment's author", !(await attemptOn(creator.address, commentName, TEXT_KEYS.author)));
check("operator may write comment records", await attemptOn(operator, commentName, TEXT_KEYS.author));

step("Permissioned Registry on live contracts");
const readRegistry = (functionName: string, args: unknown[] = []) =>
  client.readContract({ address: memberRegistry, abi: userRegistryAbi as Abi, functionName, args });
check("member registry is emancipated", (await readRegistry("isEmancipated")) === true);
const canonical = (await client.readContract({
  address: SEPOLIA.universalHelper,
  abi: universalHelperAbi as Abi,
  functionName: "findCanonicalName",
  args: [memberRegistry],
})) as Hex;
const dotted = (() => {
  const bytes = Buffer.from(canonical.slice(2), "hex");
  const labels: string[] = [];
  for (let at = 0; at < bytes.length && bytes[at] !== 0; at += bytes[at]! + 1) labels.push(bytes.subarray(at + 1, at + 1 + bytes[at]!).toString("utf8"));
  return labels.join(".");
})();
check("ENS finds the canonical name from the registry", dotted === memberName, dotted);

const rootRegistry = (await client.readContract({
  address: SEPOLIA.verifiableFactory,
  abi: parseAbi(["function predictProxyAddress(address deployer, uint256 salt) view returns (address)"]),
  functionName: "predictProxyAddress",
  args: [operator, registrySalt("commentdesk.eth")],
})) as Address;
const tokenId = (await client.readContract({
  address: rootRegistry,
  abi: userRegistryAbi as Abi,
  functionName: "findTokenId",
  args: [creatorHandle],
})) as bigint;
const sellName = await client
  .call({
    account: creator.address,
    to: rootRegistry,
    data: encodeFunctionData({ abi: userRegistryAbi as Abi, functionName: "unsafeTransfer", args: [voter.address, tokenId, "0x"] }),
  })
  .then(() => true)
  .catch(() => false);
check("a member cannot sell their name", !sellName);
const memberResolver = (await client.readContract({
  address: rootRegistry,
  abi: userRegistryAbi as Abi,
  functionName: "getResolver",
  args: [creatorHandle],
})) as Address;
const repoint = await client
  .call({
    account: operator,
    to: memberResolver,
    data: encodeFunctionData({
      abi: resolverAbi as Abi,
      functionName: "setAddress",
      args: [dnsEncode(memberName), 60n, voter.address],
    }),
  })
  .then(() => true)
  .catch(() => false);
check("operator cannot repoint a member's address", !repoint);

step("Conclude the case");
const wait = Number(deadline) - Date.now() + 3000;
if (wait > 0) {
  console.log(`waiting ${Math.ceil(wait / 1000)}s for the deadline`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}
const late = await comment(voter, docket, "Too late.", "human", "emissions");
check("comment after the deadline is refused", late.body.error === "docket_closed");
const ruling = "The rule passes, with a three-year phase-in.";
const closedAt = BigInt(Date.now());
const closed = await call("POST", `/api/dockets/${docket}/close`, {
  ruling,
  issuedAt: closedAt,
  signature: await sign(creator, "CloseDocket", { docket, rulingHash: hash(ruling), issuedAt: closedAt }),
});
check("creator publishes the ruling", closed.status === 200);

step("Swarm");
const afterClose = await until("case file reaches Swarm", () => call("GET", `/api/dockets/${docket}`), (value) => Boolean(value.body.swarmRef), 120);
const swarmRef = afterClose.body.swarmRef as string;
const verified = await call("GET", `/api/dockets/${docket}/archive/verify`);
check("file on Swarm matches Arkiv", verified.body.matches === true, stringify(verified.body));
await until("ENS points at the Swarm record", () => text(docketName, TEXT_KEYS.swarm), (value) => value === swarmRef, 240);
await until("ENS status shows closed", () => text(docketName, TEXT_KEYS.status), (value) => value === "closed", 240);

step("Result");
const failures = await call("GET", "/api/ens/failures");
check("no background failures", (failures.body as unknown as unknown[]).length === 0, stringify(failures.body));
console.log(stringify({ memberName, docketName, commentName, docket, comment: human.body.key, agentComment: agent.body.key, swarmRef, url: verified.body.url, docketResolver, memberRegistry }));
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
