import { isAddress, keccak256, type Address, type Hex } from "viem";
import type {
  ArkivStore,
  CommentRecord,
  DocketRecord,
  DocketStatus,
  MemberRecord,
} from "./arkiv/store.ts";
import { activity, STEP } from "./activity.ts";
import { recoverSigner } from "./auth.ts";
import { AppError, SerialQueue, opId, ownerHash, textHash } from "./core.ts";
import type { Naming } from "./ens/naming.ts";
import { assertUsableLabel, normalizeLabel } from "./ens/names.ts";
import { SENTIMENTS, tally, type Tally } from "./recount.ts";
import type { Archiver } from "./swarm.ts";

export type CredentialLevel = "strict" | "soft";

/** What World hands over after a proof passes. See src/host/desk-host.ts. */
export type VerifiedJoin = { proofRef: string; nullifier: string };
export type VerifiedComment = {
  memberRef: string;
  docketKey: string;
  topic: string;
  text: string;
  authorType: "human" | "agent";
  sentiment?: string;
};

export type DeskConfig = {
  policyVersion: string;
  graceDays: number;
  maxCommentsPerTopic: number;
  moderators: Address[];
};

const DAY_MS = 86_400_000;
/** Rabdi's longest lifetime is 7,884,000 blocks: about 182 days at 2s per block. */
const MAX_LIFETIME_DAYS = 182;
const MAX_TITLE_BYTES = 120;
const MAX_QUESTION_BYTES = 20_000;
const MAX_STANCE_BYTES = 8_000;
const MAX_RULING_BYTES = 60_000;
const MAX_TOPICS = 12;
/** Unencrypted Swarm reference. An encrypted one is 128 hex and contains its key. */
const SWARM_REF = /^[0-9a-f]{64}$/;
const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

function requireText(value: string, max: number, what: string) {
  if (!value.trim()) throw new AppError(422, "invalid_input", `${what} is required.`);
  if (byteLength(value) > max) throw new AppError(422, "invalid_input", `${what} is too long.`);
}

function label(raw: string, what: string): string {
  try {
    const value = normalizeLabel(raw);
    assertUsableLabel(value);
    return value;
  } catch (error) {
    throw new AppError(422, "invalid_label", `${what}: ${(error as Error).message}`);
  }
}

export function docketBodyHash(question: string, topics: string[]): Hex {
  return textHash(JSON.stringify({ question, topics }));
}

export class Desk {
  /** Check-then-write sections, so two requests cannot both pass a uniqueness check. */
  private readonly identityQueue = new SerialQueue();
  private readonly commentQueue = new SerialQueue();
  private readonly archiveQueue = new SerialQueue();
  /** Covers the moment an indexed count lags a write that just confirmed. */
  private readonly memberTopicCounts = new Map<string, number>();
  private readonly docketCounts = new Map<string, number>();
  private readonly backgroundFailures = new Map<string, string>();

  constructor(
    private readonly store: ArkivStore,
    private readonly naming: Naming,
    private readonly config: DeskConfig,
    private readonly archiver: Archiver,
  ) {}

  /** Comment and link records are written after the response, so failures are held here. */
  ensFailures() {
    return [...this.backgroundFailures].map(([name, reason]) => ({ name, reason }));
  }

  private inBackground(name: string, task: () => Promise<unknown>) {
    const release = activity.hold();
    const attempt = () => task().then(() => this.backgroundFailures.delete(name));
    attempt()
      .catch(() => attempt())
      .then(
        () => release(),
        (error: Error) => {
          this.backgroundFailures.set(name, error instanceof AppError ? error.code : "ens_failed");
          console.error(`[ens] records for ${name} failed twice`);
          release(error);
        },
      );
  }

  /** Member names being minted right now. Joining doesn't wait for them. */
  private readonly namesInProgress = new Map<string, Promise<void>>();

  /** Mints a member's ENS name after they've joined. Its steps land on the join's receipt. */
  private mintName(handle: string, wallet: Address, ensName: string): Promise<void> {
    const running = this.namesInProgress.get(ensName);
    if (running) return running;
    const release = activity.hold();
    const attempt = () => this.naming.registerMember(handle, wallet);
    const task = attempt()
      .catch(() => attempt())
      .then(
        () => {
          this.backgroundFailures.delete(ensName);
          release();
        },
        (error: Error) => {
          this.backgroundFailures.set(ensName, error instanceof AppError ? error.code : "ens_failed");
          console.error(`[ens] name ${ensName} failed twice`);
          release(error);
        },
      )
      .finally(() => this.namesInProgress.delete(ensName));
    this.namesInProgress.set(ensName, task);
    return task;
  }

  /** "creating" while the member's name is being minted, "failed" if it couldn't be. */
  nameStatus(ensName: string): "creating" | "failed" | "ready" {
    if (this.namesInProgress.has(ensName)) return "creating";
    return this.backgroundFailures.has(ensName) ? "failed" : "ready";
  }

  private namePending() {
    return new AppError(409, "name_pending", "Your ENS name is still being created. Try again in a minute.");
  }

  /** Opening a docket builds under the member's own name, so that name must exist first. */
  private async requireName(member: MemberRecord, wallet: Address) {
    if (this.namesInProgress.has(member.ensName)) throw this.namePending();
    if (await this.naming.hasName(member.ensName)) return;
    // Not on ENS, e.g. the server restarted while it was being minted: mint it again.
    const handle = member.ensName.slice(0, -(this.naming.rootName.length + 1));
    activity.untracked(() => this.mintName(handle, wallet, member.ensName));
    throw this.namePending();
  }

  private async memberFor(wallet: Address): Promise<MemberRecord> {
    const member = await this.store.findMemberByOwner(ownerHash(wallet));
    if (!member) throw new AppError(403, "not_a_member", "Join Comment Desk first.");
    return member;
  }

  private async docketOr404(key: Hex): Promise<DocketRecord> {
    const docket = await this.store.getDocket(key);
    if (!docket) throw new AppError(404, "docket_not_found", "That docket does not exist or has expired.");
    return docket;
  }

  /**
   * The first consent, signed before World is asked. Separate from the proof so
   * the World half stays unaware of policies, and joinVerified can require it.
   */
  async acceptJoinPolicy(input: { handle: string; issuedAt: bigint; signature: Hex }) {
    const handle = label(input.handle, "Handle");
    const { policyVersion } = this.config;
    const wallet = await recoverSigner(
      "Join",
      { handle: input.handle, policyVersion, issuedAt: input.issuedAt },
      input.signature,
    );
    const owner = ownerHash(wallet);
    const ensName = `${handle}.${this.naming.rootName}`;
    await this.assertIdentityFree(owner, ensName);

    return activity.track("policy", ensName, [STEP.policyRecord], () => this.identityQueue.run(async () => {
      const existing = await this.store.findPolicy(owner, "join");
      if (existing) return { key: existing.key, wallet, ensName };
      const key = await this.store.createPolicy({
        opId: opId("policy", "join", owner, policyVersion),
        ownerHash: owner,
        policy: "join",
        policyVersion,
        signatureHash: keccak256(input.signature),
        acceptedAt: BigInt(Date.now()),
      });
      return { key, wallet, ensName };
    }));
  }

  private async assertIdentityFree(owner: string, ensName: string) {
    if (await this.store.findMemberByOwner(owner)) {
      throw new AppError(409, "already_member", "This wallet has already joined.");
    }
    if (await this.store.findMemberByEns(ensName)) {
      throw new AppError(409, "handle_taken", `${ensName} is already taken.`);
    }
  }

  /** Runs after World has validated a unique human. One human, one name (NFR2). */
  async joinVerified(proof: VerifiedJoin, join: { handle: string; wallet?: string }) {
    const handle = label(join.handle, "Handle");
    if (!join.wallet || !isAddress(join.wallet)) {
      throw new AppError(422, "wallet_required", "Joining needs the member's wallet.");
    }
    const wallet = join.wallet as Address;
    const owner = ownerHash(wallet);
    const ensName = `${handle}.${this.naming.rootName}`;

    const expected = [
      STEP.worldHuman,
      STEP.memberRecord,
      STEP.resolver(ensName),
      STEP.registry(ensName),
      STEP.linked(ensName),
      STEP.registered(ensName),
    ];
    return activity.track("join", ensName, expected, () => this.identityQueue.run(async () => {
      await this.assertIdentityFree(owner, ensName);
      if (await this.store.findMemberByNullifier(proof.nullifier)) {
        throw new AppError(409, "human_already_joined", "This person already has a Comment Desk identity.");
      }
      const policy = await this.store.findPolicy(owner, "join");
      if (!policy) throw new AppError(403, "join_policy_required", "Sign the join policy first.");

      // A name already on ENS must be this wallet's (a retried join). Anyone else's is taken.
      if (await this.naming.hasName(ensName)) await this.naming.registerMember(handle, wallet);
      activity.note({ label: STEP.worldHuman, chain: "world", ref: proof.proofRef });
      const memberRef = await this.store.createMember({
        opId: opId("member", owner),
        ownerHash: owner,
        nullifierHash: proof.nullifier,
        ensName,
        proofRef: proof.proofRef,
        joinPolicyKey: policy.key,
        joinedAt: BigInt(Date.now()),
      });
      // Arkiv is the record, so the member exists now. The name follows on ENS in a minute or two.
      void this.mintName(handle, wallet, ensName);
      return { memberRef, ensName };
    }));
  }

  /** Proves control of a member's wallet, so a passkey can restore a session on any device. */
  async signIn(input: { issuedAt: bigint; signature: Hex }) {
    const wallet = await recoverSigner("SignIn", { issuedAt: input.issuedAt }, input.signature);
    const member = await this.memberFor(wallet);
    return { memberRef: member.key, ensName: member.ensName };
  }

  /** The second, separate consent. Required before a member can open a docket (FR2, FR3). */
  async acceptDocketPolicy(input: { issuedAt: bigint; signature: Hex }) {
    const { policyVersion } = this.config;
    const wallet = await recoverSigner(
      "AcceptDocketPolicy",
      { policyVersion, issuedAt: input.issuedAt },
      input.signature,
    );
    const member = await this.memberFor(wallet);
    return activity.track("policy", member.ensName, [STEP.policyRecord], () => this.identityQueue.run(async () => {
      const existing = await this.store.findPolicy(member.ownerHash, "docket-creation");
      if (existing) return { key: existing.key };
      const key = await this.store.createPolicy({
        opId: opId("policy", "docket-creation", member.ownerHash, policyVersion),
        ownerHash: member.ownerHash,
        policy: "docket-creation",
        policyVersion,
        signatureHash: keccak256(input.signature),
        acceptedAt: BigInt(Date.now()),
      });
      return { key };
    }));
  }

  async openDocket(input: {
    label: string;
    title: string;
    question: string;
    topics: string[];
    deadline: bigint;
    credentialLevel: CredentialLevel;
    issuedAt: bigint;
    signature: Hex;
  }) {
    const docketLabel = label(input.label, "Docket name");
    requireText(input.title, MAX_TITLE_BYTES, "Title");
    requireText(input.question, MAX_QUESTION_BYTES, "Question");
    const topics = input.topics.map((topic) => label(topic, "Topic"));
    if (topics.length === 0 || topics.length > MAX_TOPICS || new Set(topics).size !== topics.length) {
      throw new AppError(422, "invalid_input", `Use 1 to ${MAX_TOPICS} different topics.`);
    }

    const now = Date.now();
    const expiresOn = new Date(Number(input.deadline) + this.config.graceDays * DAY_MS);
    if (Number(input.deadline) <= now) throw new AppError(422, "invalid_input", "The deadline must be in the future.");
    if (expiresOn.getTime() > now + MAX_LIFETIME_DAYS * DAY_MS) {
      throw new AppError(422, "invalid_input", `Deadline plus grace must be within ${MAX_LIFETIME_DAYS} days.`);
    }

    const wallet = await recoverSigner(
      "OpenDocket",
      {
        label: input.label,
        title: input.title,
        bodyHash: docketBodyHash(input.question, input.topics),
        deadline: input.deadline,
        credentialLevel: input.credentialLevel,
        issuedAt: input.issuedAt,
      },
      input.signature,
    );
    const member = await this.memberFor(wallet);
    if (!(await this.store.findPolicy(member.ownerHash, "docket-creation"))) {
      throw new AppError(403, "docket_policy_required", "Sign the docket-creation policy before opening a docket.");
    }
    await this.requireName(member, wallet);

    const ensName = `${docketLabel}.${member.ensName}`;
    const expected = [
      STEP.registry(ensName),
      STEP.linked(ensName),
      STEP.docketResolver(ensName),
      STEP.registered(ensName),
      STEP.docketRecord,
      STEP.arkivLink(ensName),
    ];
    return activity.track("docket", ensName, expected, () => this.identityQueue.run(async () => {
      if (await this.store.findDocketByEns(ensName)) {
        throw new AppError(409, "docket_taken", `${ensName} already exists.`);
      }
      await this.naming.openDocket({
        memberName: member.ensName,
        label: docketLabel,
        wallet,
        records: { title: input.title, deadline: input.deadline, topics, credentialLevel: input.credentialLevel },
      });
      const key = await this.store.createDocket({
        opId: opId("docket", ensName),
        ownerHash: member.ownerHash,
        ensName,
        status: "open",
        credentialLevel: input.credentialLevel,
        deadline: input.deadline,
        createdAt: BigInt(now),
        title: input.title,
        question: input.question,
        topics,
        expiresOn,
      });
      this.inBackground(ensName, () => this.naming.linkDocket(ensName, key));
      return { key, ensName };
    }));
  }

  /**
   * Runs after World has validated one of the two gates. World binds the proof
   * to these exact words, so nothing here can change them.
   */
  async postVerifiedComment(proof: { proofRef: string }, input: VerifiedComment) {
    const world = proof.proofRef.startsWith("agentpass:") ? STEP.worldAgent : STEP.worldHuman;
    return activity.track("comment", input.docketKey, [world, STEP.commentRecord], () => this.recordComment(proof, input, world));
  }

  private async recordComment(proof: { proofRef: string }, input: VerifiedComment, world: string) {
    requireText(input.text, MAX_STANCE_BYTES, "Comment");
    const sentiment = input.sentiment ?? "neutral";
    if (!(SENTIMENTS as readonly string[]).includes(sentiment)) {
      throw new AppError(422, "invalid_input", "Sentiment must be support, oppose or neutral.");
    }
    const member = await this.store.getMember(input.memberRef as Hex);
    if (!member) throw new AppError(403, "not_a_member", "Join Comment Desk first.");
    const docket = await this.docketOr404(input.docketKey as Hex);
    this.assertAcceptingComments(docket, input.topic);

    const op = opId("comment", proof.proofRef);
    const repeat = await this.store.findCommentByOp(op);
    if (repeat) return { commentRef: repeat.key, ensName: repeat.ensName, counted: repeat.ordinal === 1 };
    activity.note({ label: world, chain: "world", ref: proof.proofRef });
    // A member who just joined may still have their name being minted; it resolves when that's done.
    await this.namesInProgress.get(member.ensName);

    // ENS decides before Arkiv records anything: the docket's rules, the
    // member's name, and for an agent, its own name.
    await this.assertEnsAllows(docket, input.authorType);
    const wallet = await this.naming.walletOf(member.ensName);
    if (input.authorType === "agent") await this.naming.ensureAgentName(member.ensName, wallet);

    const memberTopic = `${docket.key}|${member.ownerHash}|${input.topic}`;
    const posted = await this.commentQueue.run(async () => {
      const onChain = await this.store.countMemberComments(docket.key, member.ownerHash, input.topic);
      const prior = Math.max(onChain, this.memberTopicCounts.get(memberTopic) ?? 0);
      if (prior >= this.config.maxCommentsPerTopic) {
        throw new AppError(409, "already_commented", "You've already commented on this topic.");
      }
      const number = Math.max(await this.store.countComments(docket.key), this.docketCounts.get(docket.key) ?? 0) + 1;
      const ensName = `comment-${number}.${docket.ensName}`;
      const authorEns = input.authorType === "agent" ? `agent.${member.ensName}` : member.ensName;
      const commentRef = await this.store.createComment({
        opId: op,
        docketKey: docket.key,
        topic: input.topic,
        ownerHash: member.ownerHash,
        authorType: input.authorType,
        sentiment,
        submittedAt: BigInt(Date.now()),
        ensName,
        authorEns,
        proofRef: proof.proofRef,
        ordinal: prior + 1,
        stanceHash: textHash(input.text),
        stance: input.text,
        expiresAtBlock: docket.expiresAt,
      });
      this.memberTopicCounts.set(memberTopic, prior + 1);
      this.docketCounts.set(docket.key, number);
      return { commentRef, ensName, authorEns, counted: prior === 0 };
    });
    activity.rename(posted.ensName, [world, STEP.commentRecord, STEP.registered(posted.ensName), STEP.records(posted.ensName)]);

    // Arkiv is the record. The comment's own name follows without holding the response open.
    this.inBackground(posted.ensName, async () => {
      await this.naming.writeComment({
        docketName: docket.ensName,
        commentName: posted.ensName,
        authorEns: posted.authorEns,
        authorType: input.authorType,
        topic: input.topic,
        arkivKey: posted.commentRef,
        wallet,
      });
    });
    return { commentRef: posted.commentRef, ensName: posted.ensName, counted: posted.counted };
  }

  private assertAcceptingComments(docket: DocketRecord, topic: string) {
    if (docket.status !== "open" || BigInt(Date.now()) > docket.deadline) {
      throw new AppError(409, "docket_closed", "This docket is no longer taking comments.");
    }
    if (!docket.topics.includes(topic)) {
      throw new AppError(422, "unknown_topic", "That topic is not part of this docket.");
    }
  }

  /**
   * A docket's rules live in its ENS records, so the access control on those
   * records is real power: a moderator's status write stops comments here.
   * Unknown is refused, because a record nobody can read can't say yes.
   */
  private async assertEnsAllows(docket: DocketRecord, authorType?: string) {
    const rules = await this.naming.docketRules(docket.ensName);
    if (rules.status !== "open") {
      throw new AppError(409, "docket_closed", "ENS shows this docket is closed to comments.");
    }
    if (authorType === "agent" && rules.agents === "none") {
      throw new AppError(403, "agents_not_allowed", "This docket's ENS record doesn't allow agents.");
    }
  }

  /** What World asks for on a docket comes from ENS. Arkiv covers a record that isn't set. */
  async liveRules(docket: DocketRecord) {
    const rules = await this.naming.docketRules(docket.ensName);
    return {
      status: rules.status ?? "unknown",
      credential: rules.credential ?? docket.credentialLevel,
      agents: rules.agents ?? "allowed",
    };
  }

  /** Lets World refuse a dead docket before a member spends a proof on it. */
  async assertCanComment(docketKey: string, topic: string) {
    const docket = await this.docketOr404(docketKey as Hex);
    this.assertAcceptingComments(docket, topic);
    await this.assertEnsAllows(docket);
  }

  /** The creator concludes the case after its deadline with a published ruling. */
  async closeDocket(input: { docket: Hex; ruling: string; issuedAt: bigint; signature: Hex }) {
    requireText(input.ruling, MAX_RULING_BYTES, "Ruling");
    const rulingHash = textHash(input.ruling);
    const wallet = await recoverSigner(
      "CloseDocket",
      { docket: input.docket, rulingHash, issuedAt: input.issuedAt },
      input.signature,
    );
    const docket = await this.docketOr404(input.docket);
    if (docket.ownerHash !== ownerHash(wallet)) {
      throw new AppError(403, "not_docket_creator", "Only this docket's creator can publish its ruling.");
    }
    if (docket.status !== "open") throw new AppError(409, "docket_closed", "This docket is already closed.");
    if (BigInt(Date.now()) < docket.deadline) {
      throw new AppError(409, "deadline_not_reached", "The ruling can be published after the deadline.");
    }
    const expected = [STEP.docketUpdate, STEP.status(docket.ensName, "closed"), STEP.swarmUpload, STEP.swarmPointer(docket.ensName)];
    return activity.track("ruling", docket.ensName, expected, () => this.recordRuling(docket, input.ruling, rulingHash));
  }

  private async recordRuling(docket: DocketRecord, ruling: string, rulingHash: Hex) {
    await this.store.patchDocket(docket.key, {
      opId: opId("close", docket.key),
      status: "closed",
      ruling,
      rulingHash,
      closedAt: BigInt(Date.now()),
    });
    this.inBackground(docket.ensName, () => this.naming.setDocketStatus(docket.ensName, "closed", "operator"));
    this.inBackground(`${docket.ensName}#archive`, () => this.publishArchive(docket.key));
    return { key: docket.key, status: "closed" as DocketStatus };
  }

  /** Platform moderators can close early for policy violations, and change nothing else. */
  async moderateDocket(input: { docket: Hex; reason: string; issuedAt: bigint; signature: Hex }) {
    requireText(input.reason, 500, "Reason");
    const wallet = await recoverSigner(
      "ModerateDocket",
      { docket: input.docket, reason: input.reason, issuedAt: input.issuedAt },
      input.signature,
    );
    if (!this.config.moderators.includes(wallet.toLowerCase() as Address)) {
      throw new AppError(403, "not_a_moderator", "This wallet is not a moderator.");
    }
    const docket = await this.docketOr404(input.docket);
    if (docket.status !== "open") throw new AppError(409, "docket_closed", "This docket is already closed.");
    const expected = [STEP.docketUpdate, STEP.status(docket.ensName, "closed-for-cause"), STEP.swarmUpload, STEP.swarmPointer(docket.ensName)];
    return activity.track("moderation", docket.ensName, expected, () => this.recordModeration(docket, input.reason));
  }

  private async recordModeration(docket: DocketRecord, reason: string) {
    await this.store.patchDocket(docket.key, {
      opId: opId("moderate", docket.key),
      status: "closed-for-cause",
      ruling: `Closed for cause: ${reason}`,
      closedAt: BigInt(Date.now()),
    });
    this.inBackground(docket.ensName, () =>
      this.naming.setDocketStatus(docket.ensName, "closed-for-cause", "moderator"),
    );
    this.inBackground(`${docket.ensName}#archive`, () => this.publishArchive(docket.key));
    return { key: docket.key, status: "closed-for-cause" as DocketStatus };
  }

  /**
   * Records the Swarm upload on Arkiv and on ENS. ENS keeps the pointer alive
   * after the docket entity expires.
   */
  async attachArchive(input: { docket: Hex; swarmRef: string; issuedAt: bigint; signature: Hex }) {
    if (!SWARM_REF.test(input.swarmRef)) {
      throw new AppError(422, "invalid_swarm_ref", "Use an unencrypted 64-character reference. Encrypted references contain their key and Arkiv is public.");
    }
    const wallet = await recoverSigner(
      "AttachArchive",
      { docket: input.docket, swarmRef: input.swarmRef, issuedAt: input.issuedAt },
      input.signature,
    );
    const docket = await this.docketOr404(input.docket);
    if (docket.ownerHash !== ownerHash(wallet)) {
      throw new AppError(403, "not_docket_creator", "Only this docket's creator can attach its archive.");
    }
    if (docket.status === "open") throw new AppError(409, "docket_open", "Close the docket before archiving it.");
    await this.store.patchDocket(docket.key, { opId: opId("archive", docket.key), swarmRef: input.swarmRef });
    this.inBackground(docket.ensName, () => this.naming.setDocketArchive(docket.ensName, input.swarmRef));
    return { key: docket.key, swarmRef: input.swarmRef };
  }

  async tally(key: Hex): Promise<{ docket: DocketRecord; comments: CommentRecord[]; tally: Tally }> {
    const docket = await this.docketOr404(key);
    const comments = await this.store.listComments(docket.key);
    return { docket, comments, tally: tally(docket, comments.map(toTallyComment)) };
  }

  /** The file the Swarm upload stores: ruling, final tally and every comment. */
  async archive(key: Hex) {
    const { docket, comments, tally: result } = await this.tally(key);
    if (docket.status === "open") throw new AppError(409, "docket_open", "Close the docket before archiving it.");
    return { docket, ruling: docket.ruling ?? null, tally: result, comments };
  }

  /**
   * Uploads the case file to Swarm and points Arkiv and ENS at it. Runs after
   * close, and is safe to run again: a docket that has a reference keeps it.
   */
  async publishArchive(key: Hex) {
    return this.archiveQueue.run(async () => {
      const bundle = await this.archive(key);
      if (bundle.docket.swarmRef) {
        return { swarmRef: bundle.docket.swarmRef, url: this.archiver.urlFor(bundle.docket.swarmRef) };
      }
      const swarmRef = await this.archiver.upload(`${bundle.docket.ensName}.json`, archiveFile(bundle));
      activity.note({ label: STEP.swarmUpload, chain: "swarm", ref: swarmRef });
      await this.store.patchDocket(key, { opId: opId("archive", key), swarmRef });
      this.inBackground(`${bundle.docket.ensName}#swarm`, () =>
        this.naming.setDocketArchive(bundle.docket.ensName, swarmRef),
      );
      return { swarmRef, url: this.archiver.urlFor(swarmRef) };
    });
  }

  /** Reads the file back from Swarm and compares it with the live record on Arkiv. */
  async verifyArchive(key: Hex) {
    const { docket, comments, tally: live } = await this.tally(key);
    if (!docket.swarmRef) throw new AppError(404, "archive_missing", "This docket has no archive yet.");
    const file = JSON.parse(await this.archiver.read(docket.swarmRef)) as {
      docket: { rulingHash?: string };
      comments: { key: string }[];
      tally: { counted: number };
    };
    const onArkiv = new Set<string>(comments.map((comment) => comment.key));
    return {
      swarmRef: docket.swarmRef,
      url: this.archiver.urlFor(docket.swarmRef),
      commentsInFile: file.comments.length,
      commentsOnArkiv: comments.length,
      matches:
        file.docket.rulingHash === docket.rulingHash &&
        file.tally.counted === live.counted &&
        file.comments.length === comments.length &&
        file.comments.every((comment) => onArkiv.has(comment.key)),
    };
  }

  /**
   * One name in the tree under the root: its live ENS records, the Arkiv record behind it,
   * and the names directly under it. The ENS app can't list ENSv2 subnames, so this does.
   */
  async nameTree(name: string) {
    const root = this.naming.rootName;
    if (name !== root && !name.endsWith(`.${root}`)) {
      throw new AppError(404, "not_comment_desk", `${name} is not under ${root}.`);
    }
    const depth = name.split(".").length - root.split(".").length;
    const kind =
      depth === 0 ? "root" : depth === 1 ? "member" : depth === 2 ? (name.startsWith("agent.") ? "agent" : "docket") : "comment";
    const parent = depth === 0 ? null : name.slice(name.indexOf(".") + 1);
    const info = await this.naming.nameInfo(name);

    let arkivKey: string | null = null;
    let children: { name: string; kind: string; detail?: string }[] = [];
    if (kind === "root") {
      children = (await this.store.listMembers()).map((member) => ({ name: member.ensName, kind: "member" }));
    } else if (kind === "member") {
      arkivKey = (await this.store.findMemberByEns(name))?.key ?? null;
      const dockets = (await this.store.listDockets()).filter(
        (docket) => docket.ensName.slice(docket.ensName.indexOf(".") + 1) === name,
      );
      const agent = `agent.${name}`;
      // Registered, not just resolvable: the member's resolver holds the agent's record from the start.
      const hasAgent = await this.naming.hasName(agent).catch(() => false);
      children = [
        ...(hasAgent ? [{ name: agent, kind: "agent", detail: "Posts the member's agent-drafted comments" }] : []),
        ...dockets.map((docket) => ({ name: docket.ensName, kind: "docket", detail: docket.title })),
      ];
    } else if (kind === "docket") {
      const docket = await this.store.findDocketByEns(name);
      arkivKey = docket?.key ?? null;
      if (docket) {
        children = (await this.store.listComments(docket.key)).map((comment) => ({
          name: comment.ensName,
          kind: "comment",
          detail: `${comment.topic} · ${comment.sentiment} · by ${comment.authorEns}`,
        }));
      }
    } else if (kind === "comment") {
      const docket = parent ? await this.store.findDocketByEns(parent) : undefined;
      const comment = docket ? (await this.store.listComments(docket.key)).find((item) => item.ensName === name) : undefined;
      arkivKey = comment?.key ?? null;
    }
    return { ...info, kind, parent, arkivKey, nameStatus: kind === "member" ? this.nameStatus(name) : undefined, children };
  }

  async stats() {
    const [base, dockets] = await Promise.all([this.store.stats(), this.store.listDockets()]);
    const tallies = await Promise.all(dockets.map((docket) => this.tally(docket.key)));
    return { ...base, countedComments: tallies.reduce((sum, item) => sum + item.tally.counted, 0) };
  }
}

/** The public case file. Stands alone: it can be recounted after the Arkiv entities expire. */
export function archiveFile(bundle: { docket: DocketRecord; ruling: string | null; tally: Tally; comments: CommentRecord[] }) {
  const { docket, ruling, tally: result, comments } = bundle;
  return JSON.stringify(
    {
      version: 1,
      docket: {
        key: docket.key,
        ensName: docket.ensName,
        title: docket.title,
        question: docket.question,
        topics: docket.topics,
        deadline: docket.deadline,
        status: docket.status,
        closedAt: docket.closedAt,
        rulingHash: docket.rulingHash,
      },
      ruling,
      tally: result,
      comments: comments.map(({ opId: _op, ...comment }) => comment),
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

export function toTallyComment(comment: CommentRecord) {
  return {
    key: comment.key,
    topic: comment.topic,
    ownerHash: comment.ownerHash,
    authorType: comment.authorType,
    sentiment: comment.sentiment,
    submittedAt: comment.submittedAt,
  };
}
