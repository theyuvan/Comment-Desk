import { keccak256, type Address, type Hex } from "viem";
import type {
  ArkivStore,
  CommentRecord,
  DocketRecord,
  DocketStatus,
  MemberRecord,
} from "./arkiv/store.ts";
import { recoverSigner } from "./auth.ts";
import { AppError, SerialQueue, opId, ownerHash, textHash } from "./core.ts";
import type { Naming } from "./ens/naming.ts";
import { assertUsableLabel, normalizeLabel } from "./ens/names.ts";
import { SENTIMENTS, tally, type Tally } from "./recount.ts";
import type { Archiver } from "./swarm.ts";
import { WorldDenied, type CredentialLevel, type WorldGate } from "./world.ts";

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

/** The exact text and context a World proof or Agent Pass confirm is bound to. */
export function submissionKey(input: {
  docket: Hex;
  topic: string;
  sentiment: string;
  stanceHash: Hex;
  authorType: string;
  owner: Hex;
}): Hex {
  return opId("submission", input.docket, input.topic, input.sentiment, input.stanceHash, input.authorType, input.owner);
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
    private readonly world: WorldGate,
    private readonly config: DeskConfig,
    private readonly archiver: Archiver,
  ) {}

  /** Comment and link records are written after the response, so failures are held here. */
  ensFailures() {
    return [...this.backgroundFailures].map(([name, reason]) => ({ name, reason }));
  }

  private inBackground(name: string, task: () => Promise<unknown>) {
    const attempt = () => task().then(() => this.backgroundFailures.delete(name));
    attempt().catch(() =>
      attempt().catch((error: Error) => {
        this.backgroundFailures.set(name, error instanceof AppError ? error.code : "ens_failed");
        console.error(`[ens] records for ${name} failed twice`);
      }),
    );
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

  async join(input: { handle: string; issuedAt: bigint; signature: Hex; proof: unknown }) {
    const handle = label(input.handle, "Handle");
    const { policyVersion } = this.config;
    const wallet = await recoverSigner(
      "Join",
      { handle: input.handle, policyVersion, issuedAt: input.issuedAt },
      input.signature,
    );
    const owner = ownerHash(wallet);
    const ensName = `${handle}.${this.naming.rootName}`;

    const assertFree = async () => {
      if (await this.store.findMemberByOwner(owner)) {
        throw new AppError(409, "already_member", "This wallet has already joined.");
      }
      if (await this.store.findMemberByEns(ensName)) {
        throw new AppError(409, "handle_taken", `${ensName} is already taken.`);
      }
    };
    await assertFree();
    const verified = await this.world.verifyJoin({ proof: input.proof, signal: keccak256(input.signature) });

    return this.identityQueue.run(async () => {
      await assertFree();
      if (await this.store.findMemberByNullifier(verified.nullifierHash)) {
        throw new AppError(409, "human_already_joined", "This person already has a Comment Desk identity.");
      }

      const now = BigInt(Date.now());
      const existingPolicy = await this.store.findPolicy(owner, "join");
      const joinPolicyKey =
        existingPolicy?.key ??
        (await this.store.createPolicy({
          opId: opId("policy", "join", owner, policyVersion),
          ownerHash: owner,
          policy: "join",
          policyVersion,
          signatureHash: keccak256(input.signature),
          acceptedAt: now,
        }));

      await this.naming.registerMember(handle, wallet);
      const key = await this.store.createMember({
        opId: opId("member", owner),
        ownerHash: owner,
        nullifierHash: verified.nullifierHash,
        ensName,
        proofRef: verified.proofRef,
        joinPolicyKey,
        joinedAt: now,
      });
      return { key, ensName };
    });
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
    return this.identityQueue.run(async () => {
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
    });
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

    return this.identityQueue.run(async () => {
      const ensName = `${docketLabel}.${member.ensName}`;
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
    });
  }

  async submitComment(input: {
    docket: Hex;
    topic: string;
    sentiment: string;
    stance: string;
    authorType: "human" | "agent";
    issuedAt: bigint;
    signature: Hex;
    proof: unknown;
  }) {
    requireText(input.stance, MAX_STANCE_BYTES, "Comment");
    if (!(SENTIMENTS as readonly string[]).includes(input.sentiment)) {
      throw new AppError(422, "invalid_input", "Sentiment must be support, oppose or neutral.");
    }

    const stanceHash = textHash(input.stance);
    const wallet = await recoverSigner(
      "SubmitComment",
      {
        docket: input.docket,
        topic: input.topic,
        sentiment: input.sentiment,
        stanceHash,
        authorType: input.authorType,
        issuedAt: input.issuedAt,
      },
      input.signature,
    );
    const member = await this.memberFor(wallet);
    const docket = await this.docketOr404(input.docket);
    if (docket.status !== "open" || BigInt(Date.now()) > docket.deadline) {
      throw new AppError(409, "docket_closed", "This docket is no longer taking comments.");
    }
    if (!docket.topics.includes(input.topic)) {
      throw new AppError(422, "unknown_topic", "That topic is not part of this docket.");
    }

    const op = opId("comment", input.signature);
    const repeat = await this.store.findCommentByOp(op);
    if (repeat) return { key: repeat.key, ensName: repeat.ensName, counted: repeat.ordinal === 1, repeated: true };

    const memberTopic = `${docket.key}|${member.ownerHash}|${input.topic}`;
    const priorComments = async () => {
      const onChain = await this.store.countMemberComments(docket.key, member.ownerHash, input.topic);
      return Math.max(onChain, this.memberTopicCounts.get(memberTopic) ?? 0);
    };
    const assertUnderCap = async () => {
      const prior = await priorComments();
      if (prior >= this.config.maxCommentsPerTopic) {
        throw new AppError(409, "comment_cap_reached", `You can comment ${this.config.maxCommentsPerTopic} times per topic.`);
      }
      return prior;
    };
    await assertUnderCap();

    // The two gates. Both are bound to this exact text through the key.
    const key = submissionKey({
      docket: docket.key,
      topic: input.topic,
      sentiment: input.sentiment,
      stanceHash,
      authorType: input.authorType,
      owner: member.ownerHash as Hex,
    });
    const credentialLevel = docket.credentialLevel as CredentialLevel;
    let proofRef: string;
    if (input.authorType === "human") {
      const verified = await this.world.verifyHumanComment({ proof: input.proof, signal: key, credentialLevel });
      proofRef = verified.proofRef;
    } else {
      const confirmed = await this.world.verifyAgentConfirm({ proof: input.proof, draftKey: key, credentialLevel });
      // Checked here too: an old approval must never carry different text.
      if (confirmed.draftKey !== key) {
        throw new WorldDenied("draft_mismatch", "The draft changed after it was approved. Nothing was posted.");
      }
      proofRef = confirmed.proofRef;
    }

    const posted = await this.commentQueue.run(async () => {
      const prior = await assertUnderCap();
      const number = Math.max(await this.store.countComments(docket.key), this.docketCounts.get(docket.key) ?? 0) + 1;
      const ensName = `comment-${number}.${docket.ensName}`;
      const authorEns =
        input.authorType === "agent" ? `agent.${member.ensName}` : member.ensName;
      const commentKey = await this.store.createComment({
        opId: op,
        docketKey: docket.key,
        topic: input.topic,
        ownerHash: member.ownerHash,
        authorType: input.authorType,
        sentiment: input.sentiment,
        submittedAt: BigInt(Date.now()),
        ensName,
        authorEns,
        proofRef,
        ordinal: prior + 1,
        stanceHash,
        stance: input.stance,
        expiresAtBlock: docket.expiresAt,
      });
      this.memberTopicCounts.set(memberTopic, prior + 1);
      this.docketCounts.set(docket.key, number);
      return { key: commentKey, ensName, authorEns, counted: prior === 0 };
    });

    // Arkiv is the record. ENS names follow without holding the response open.
    this.inBackground(posted.ensName, async () => {
      if (input.authorType === "agent") await this.naming.ensureAgentName(member.ensName, wallet);
      await this.naming.writeComment({
        docketName: docket.ensName,
        commentName: posted.ensName,
        authorEns: posted.authorEns,
        authorType: input.authorType,
        topic: input.topic,
        arkivKey: posted.key,
      });
    });
    return { key: posted.key, ensName: posted.ensName, counted: posted.counted, repeated: false };
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
    await this.store.patchDocket(docket.key, {
      opId: opId("close", docket.key),
      status: "closed",
      ruling: input.ruling,
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
    await this.store.patchDocket(docket.key, {
      opId: opId("moderate", docket.key),
      status: "closed-for-cause",
      ruling: `Closed for cause: ${input.reason}`,
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
