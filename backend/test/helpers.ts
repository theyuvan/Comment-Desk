import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type {
  ArkivStore,
  CommentRecord,
  DocketPatch,
  DocketRecord,
  DocketStatus,
  MemberRecord,
  NewComment,
  NewDocket,
  NewMember,
  NewPolicy,
  PolicyName,
  PolicyRecord,
} from "../src/arkiv/store.ts";
import { DOMAIN, TYPES, type ActionName } from "../src/auth.ts";
import { opId, ownerHash, textHash } from "../src/core.ts";
import { Desk, docketBodyHash } from "../src/desk.ts";
import type { DocketRecords, DocketRules, Naming } from "../src/ens/naming.ts";
import type { Archiver } from "../src/swarm.ts";

let sequence = 0;
const nextKey = () => opId("key", ++sequence);

/** Holds what would be written to Arkiv, so tests can inspect every public field. */
export class MemoryStore implements ArkivStore {
  policies: (PolicyRecord & { opId: string })[] = [];
  members: MemberRecord[] = [];
  dockets: DocketRecord[] = [];
  comments: CommentRecord[] = [];

  async createPolicy(input: NewPolicy) {
    const key = nextKey();
    this.policies.push({ ...input, key });
    return key;
  }
  async findPolicy(ownerHash: string, policy: PolicyName) {
    return this.policies.find((item) => item.ownerHash === ownerHash && item.policy === policy);
  }
  async createMember(input: NewMember) {
    const key = nextKey();
    this.members.push({ ...input, key });
    return key;
  }
  async getMember(key: Hex) {
    return this.members.find((item) => item.key === key);
  }
  async findMemberByOwner(ownerHash: string) {
    return this.members.find((item) => item.ownerHash === ownerHash);
  }
  async findMemberByNullifier(nullifierHash: string) {
    return this.members.find((item) => item.nullifierHash === nullifierHash);
  }
  async findMemberByEns(ensName: string) {
    return this.members.find((item) => item.ensName === ensName);
  }
  async listMembers() {
    return [...this.members].reverse();
  }
  async createDocket({ expiresOn: _expiresOn, ...input }: NewDocket) {
    const key = nextKey();
    this.dockets.push({ ...input, key, expiresAt: 5000n });
    return key;
  }
  async getDocket(key: Hex) {
    return this.dockets.find((item) => item.key === key);
  }
  async findDocketByEns(ensName: string) {
    return this.dockets.find((item) => item.ensName === ensName);
  }
  async listDockets(status?: DocketStatus) {
    return this.dockets.filter((item) => !status || item.status === status);
  }
  async patchDocket(key: Hex, { opId: _op, ...patch }: DocketPatch) {
    const docket = this.dockets.find((item) => item.key === key)!;
    Object.assign(docket, patch);
  }
  async createComment({ expiresAtBlock: _expires, ...input }: NewComment) {
    const key = nextKey();
    this.comments.push({ ...input, key });
    return key;
  }
  async findCommentByOp(id: string) {
    return this.comments.find((item) => item.opId === id);
  }
  async listComments(docketKey: string) {
    return this.comments.filter((item) => item.docketKey === docketKey);
  }
  async countComments(docketKey: string) {
    return (await this.listComments(docketKey)).length;
  }
  async countMemberComments(docketKey: string, ownerHash: string, topic: string) {
    return this.comments.filter(
      (item) => item.docketKey === docketKey && item.ownerHash === ownerHash && item.topic === topic,
    ).length;
  }
  async stats() {
    return { members: this.members.length, dockets: this.dockets.length, comments: this.comments.length };
  }
}

export class MemoryNaming implements Naming {
  readonly rootName = "commentdesk.eth";
  calls: string[] = [];

  wallets = new Map<string, Address>();
  rules = new Map<string, DocketRules>();

  async registerMember(label: string, wallet: Address) {
    this.calls.push(`member:${label}`);
    const name = `${label}.${this.rootName}`;
    this.wallets.set(name, wallet);
    return name;
  }
  async hasName(memberName: string) {
    return this.wallets.has(memberName);
  }
  async nameInfo(name: string) {
    const rules = this.rules.get(name);
    const records: Record<string, string> = {};
    if (rules?.status) records.status = rules.status;
    if (rules?.credential) records["commentdesk.credential"] = rules.credential;
    return { name, address: this.wallets.get(name) ?? null, resolver: null, records };
  }
  async walletOf(memberName: string) {
    return this.wallets.get(memberName)!;
  }
  async openDocket({ memberName, label, records }: { memberName: string; label: string; records: DocketRecords }) {
    this.calls.push(`docket:${label}`);
    const name = `${label}.${memberName}`;
    this.rules.set(name, { status: "open", credential: records.credentialLevel, agents: "allowed" });
    return name;
  }
  async docketRules(name: string) {
    return this.rules.get(name) ?? { status: null, credential: null, agents: null };
  }
  async linkDocket(name: string) {
    this.calls.push(`link:${name}`);
  }
  async writeComment({ commentName }: { commentName: string }) {
    this.calls.push(`comment:${commentName}`);
  }
  async ensureAgentName(memberName: string) {
    this.calls.push(`agent:${memberName}`);
    return `agent.${memberName}`;
  }
  async setDocketStatus(name: string, status: string, by: string) {
    this.calls.push(`status:${name}:${status}:${by}`);
    const rules = this.rules.get(name);
    if (rules) this.rules.set(name, { ...rules, status });
  }
  async setDocketArchive(name: string, ref: string) {
    this.calls.push(`archive:${name}:${ref}`);
  }
}

/** Holds uploads in memory, keyed the way Swarm would return them. */
export class MemoryArchiver implements Archiver {
  files = new Map<string, string>();
  failUploads = false;

  urlFor(reference: string) {
    return `memory://${reference}`;
  }
  async upload(_name: string, json: string) {
    if (this.failUploads) throw new Error("upload failed");
    const reference = textHash(json).slice(2);
    this.files.set(reference, json);
    return reference;
  }
  async read(reference: string) {
    const file = this.files.get(reference);
    if (!file) throw new Error("not found");
    return file;
  }
}

export const newWallet = () => privateKeyToAccount(generatePrivateKey());
export type Wallet = ReturnType<typeof newWallet>;

export const sign = (wallet: Wallet, primaryType: ActionName, message: Record<string, unknown>) =>
  wallet.signTypedData({
    domain: DOMAIN,
    types: { [primaryType]: TYPES[primaryType] },
    primaryType,
    message,
  } as never);

export function harness(config: { moderators?: Address[]; maxCommentsPerTopic?: number } = {}) {
  const store = new MemoryStore();
  const naming = new MemoryNaming();
  const archiver = new MemoryArchiver();
  const desk = new Desk(
    store,
    naming,
    {
      policyVersion: "1",
      graceDays: 7,
      maxCommentsPerTopic: config.maxCommentsPerTopic ?? 1,
      moderators: config.moderators ?? [],
    },
    archiver,
  );

  const signJoin = async (wallet: Wallet, handle: string) => {
    const issuedAt = BigInt(Date.now());
    const signature = await sign(wallet, "Join", { handle, policyVersion: "1", issuedAt });
    return desk.acceptJoinPolicy({ handle, issuedAt, signature });
  };
  /** Stands for World having validated this human. */
  const verifyJoin = (wallet: Wallet, handle: string, human = handle) =>
    desk.joinVerified({ proofRef: `proof-${human}`, nullifier: `nullifier-${human}` }, { handle, wallet: wallet.address });
  const join = async (wallet: Wallet, handle: string, human = handle) => {
    await signJoin(wallet, handle);
    return verifyJoin(wallet, handle, human);
  };
  const acceptPolicy = async (wallet: Wallet) => {
    const issuedAt = BigInt(Date.now());
    const signature = await sign(wallet, "AcceptDocketPolicy", { policyVersion: "1", issuedAt });
    return desk.acceptDocketPolicy({ issuedAt, signature });
  };
  const open = async (wallet: Wallet, label = "truck-rule", deadline = BigInt(Date.now() + 86_400_000)) => {
    const issuedAt = BigInt(Date.now());
    const question = "Should the rule pass?";
    const topics = ["emissions", "cost"];
    const credentialLevel = "soft" as const;
    const title = "Truck emissions rule";
    const signature = await sign(wallet, "OpenDocket", {
      label,
      title,
      bodyHash: docketBodyHash(question, topics),
      deadline,
      credentialLevel,
      issuedAt,
    });
    return desk.openDocket({ label, title, question, topics, deadline, credentialLevel, issuedAt, signature });
  };
  const comment = async (
    wallet: Wallet,
    docket: Hex,
    options: { stance?: string; authorType?: "human" | "agent"; topic?: string; sentiment?: string; proofRef?: string } = {},
  ) => {
    const { stance = "I support this.", authorType = "human", topic = "emissions", sentiment = "support" } = options;
    const member = await store.findMemberByOwner(ownerHash(wallet.address));
    return desk.postVerifiedComment(
      { proofRef: options.proofRef ?? `proof-${++sequence}` },
      { memberRef: member?.key ?? `0x${"00".repeat(32)}`, docketKey: docket, topic, text: stance, authorType, sentiment },
    );
  };
  const creator = async (wallet: Wallet, handle = "maya") => {
    await join(wallet, handle);
    await acceptPolicy(wallet);
    return open(wallet);
  };
  return { store, naming, archiver, desk, signJoin, verifyJoin, join, acceptPolicy, open, comment, creator };
}

/** Lets background ENS writes finish. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
