import { ExpirationTime } from "@arkiv-network/sdk";
import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { i32, key as keyValue, u64, type Schema } from "@arkiv-network/sdk/schema";
import { hexToString, stringToBytes, type Address, type Hex } from "viem";
import { AppError } from "../core.ts";
import { CommentSchema, DocketSchema, MemberSchema, PolicyAcceptanceSchema } from "@commentdesk/contracts/arkiv";
import type { ArkivWriter } from "./writer.ts";

/**
 * Every entity here is public, forever, in calldata. Raw wallets and raw
 * signatures must never reach this layer: `$owner` and `$creator` are the
 * platform's publisher wallet, and people are identified only by owner_hash.
 */

export type PolicyName = "join" | "docket-creation";
export type DocketStatus = "open" | "closed" | "closed-for-cause";

export type MemberRecord = {
  key: Hex;
  opId: string;
  ownerHash: string;
  nullifierHash: string;
  ensName: string;
  proofRef: string;
  joinPolicyKey: string;
  joinedAt: bigint;
};

export type PolicyRecord = {
  key: Hex;
  ownerHash: string;
  policy: PolicyName;
  policyVersion: string;
  signatureHash: string;
  acceptedAt: bigint;
};

export type DocketRecord = {
  key: Hex;
  opId: string;
  ownerHash: string;
  ensName: string;
  status: DocketStatus;
  credentialLevel: string;
  deadline: bigint;
  createdAt: bigint;
  title: string;
  question: string;
  topics: string[];
  ruling?: string;
  rulingHash?: string;
  closedAt?: bigint;
  swarmRef?: string;
  expiresAt: bigint;
};

export type CommentRecord = {
  key: Hex;
  opId: string;
  docketKey: string;
  topic: string;
  ownerHash: string;
  authorType: "human" | "agent";
  sentiment: string;
  submittedAt: bigint;
  ensName: string;
  authorEns: string;
  proofRef: string;
  ordinal: number;
  stanceHash: string;
  stance: string;
};

export type NewMember = Omit<MemberRecord, "key">;
export type NewPolicy = Omit<PolicyRecord, "key"> & { opId: string };
export type NewDocket = Omit<DocketRecord, "key" | "expiresAt" | "ruling" | "rulingHash" | "closedAt" | "swarmRef"> & {
  expiresOn: Date;
};
export type NewComment = Omit<CommentRecord, "key"> & { expiresAtBlock: bigint };
export type DocketPatch = Partial<Pick<DocketRecord, "status" | "ruling" | "rulingHash" | "closedAt" | "swarmRef">> & {
  opId: string;
};
export type Stats = { members: number; dockets: number; comments: number };

/** Services depend on this, so they can be tested without a network. */
export interface ArkivStore {
  createPolicy(input: NewPolicy): Promise<Hex>;
  findPolicy(ownerHash: string, policy: PolicyName): Promise<PolicyRecord | undefined>;
  createMember(input: NewMember): Promise<Hex>;
  getMember(key: Hex): Promise<MemberRecord | undefined>;
  findMemberByOwner(ownerHash: string): Promise<MemberRecord | undefined>;
  findMemberByNullifier(nullifierHash: string): Promise<MemberRecord | undefined>;
  findMemberByEns(ensName: string): Promise<MemberRecord | undefined>;
  createDocket(input: NewDocket): Promise<Hex>;
  getDocket(key: Hex): Promise<DocketRecord | undefined>;
  findDocketByEns(ensName: string): Promise<DocketRecord | undefined>;
  listDockets(status?: DocketStatus): Promise<DocketRecord[]>;
  patchDocket(key: Hex, patch: DocketPatch): Promise<void>;
  createComment(input: NewComment): Promise<Hex>;
  findCommentByOp(opId: string): Promise<CommentRecord | undefined>;
  listComments(docketKey: string): Promise<CommentRecord[]>;
  countComments(docketKey: string): Promise<number>;
  countMemberComments(docketKey: string, ownerHash: string, topic: string): Promise<number>;
  stats(): Promise<Stats>;
}

type Cell<T> = { value: T } | undefined;
const cell = <T>(value: Cell<T>): T => value?.value as T;
const optional = <T>(value: Cell<T>): T | undefined => value?.value;
const fromHex = (hex: Hex | undefined) => (hex ? hexToString(hex) : "");

// Row shapes come from the schemas at runtime; the SDK's generics do not survive `select("*")` helpers.
type AnyRow = Record<string, never> & { $key: Hex; $expiresAt: bigint };

function toMember(row: AnyRow): MemberRecord {
  return {
    key: row.$key,
    opId: cell<string>(row.op_id),
    ownerHash: cell<string>(row.owner_hash),
    nullifierHash: cell<string>(row.nullifier_hash),
    ensName: cell<string>(row.ens_name),
    proofRef: cell<string>(row.proof_ref),
    joinPolicyKey: cell<string>(row.join_policy_key),
    joinedAt: cell<bigint>(row.joined_at),
  };
}

function toPolicy(row: AnyRow): PolicyRecord {
  return {
    key: row.$key,
    ownerHash: cell<string>(row.owner_hash),
    policy: cell<PolicyName>(row.policy),
    policyVersion: cell<string>(row.policy_version),
    signatureHash: cell<string>(row.signature_hash),
    acceptedAt: cell<bigint>(row.accepted_at),
  };
}

function toDocket(row: AnyRow): DocketRecord {
  const body = JSON.parse(fromHex(cell<Hex>(row.body)) || "{}") as { question?: string; topics?: string[] };
  const ruling = optional<Hex>(row.ruling);
  return {
    key: row.$key,
    opId: cell<string>(row.op_id),
    ownerHash: cell<string>(row.owner_hash),
    ensName: cell<string>(row.ens_name),
    status: cell<DocketStatus>(row.status),
    credentialLevel: cell<string>(row.credential_level),
    deadline: cell<bigint>(row.deadline),
    createdAt: cell<bigint>(row.created_at),
    title: cell<string>(row.title),
    question: body.question ?? "",
    topics: body.topics ?? [],
    ruling: ruling ? fromHex(ruling) : undefined,
    rulingHash: optional<string>(row.ruling_hash),
    closedAt: optional<bigint>(row.closed_at),
    swarmRef: optional<string>(row.swarm_ref),
    expiresAt: row.$expiresAt,
  };
}

function toComment(row: AnyRow): CommentRecord {
  return {
    key: row.$key,
    opId: cell<string>(row.op_id),
    docketKey: cell<string>(row.docket_key),
    topic: cell<string>(row.topic),
    ownerHash: cell<string>(row.owner_hash),
    authorType: cell<"human" | "agent">(row.author_type),
    sentiment: cell<string>(row.sentiment),
    submittedAt: cell<bigint>(row.submitted_at),
    ensName: cell<string>(row.ens_name),
    authorEns: cell<string>(row.author_ens),
    proofRef: cell<string>(row.proof_ref),
    ordinal: cell<number>(row.ordinal),
    stanceHash: cell<string>(row.stance_hash),
    stance: fromHex(cell<Hex>(row.stance)),
  };
}

const PAGE = 100;
const MAX_PAGES = 200;

export class LiveArkivStore implements ArkivStore {
  private readonly reader: ArkivWriter["reader"];
  private readonly publisher: Address;

  constructor(private readonly writer: ArkivWriter) {
    this.reader = writer.reader;
    this.publisher = writer.account.address;
  }

  /** Scoped to the publisher: a schema tag alone can be copied by anyone. */
  private select<S extends Schema>(schema: S) {
    return (this.reader.select("*") as never as ReturnType<typeof this.reader.select>)
      .from(schema, { onMismatch: "throw" })
      .createdBy(this.publisher);
  }

  private async first(schema: Schema, column: string, value: string): Promise<AnyRow | undefined> {
    const page = await this.select(schema).where(eq(column, value)).limit(1).fetch();
    return page.entities[0] as never;
  }

  /** Walks every page by `$key`. Throws rather than return a partial list. */
  private async all(schema: Schema, filter?: ReturnType<typeof eq>): Promise<AnyRow[]> {
    const rows: AnyRow[] = [];
    let last: Hex | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const builder = this.select(schema).orderBy(asc("$key")).limit(PAGE);
      const after = last ? gt("$key", keyValue(last)) : undefined;
      const where = filter && after ? and(filter, after) : (filter ?? after);
      if (where) builder.where(where);
      const { entities } = await builder.fetch();
      rows.push(...(entities as never as AnyRow[]));
      if (entities.length < PAGE) return rows;
      last = rows.at(-1)?.$key;
    }
    throw new AppError(502, "arkiv_page_budget", "Too many records to read at once.");
  }

  async createPolicy(input: NewPolicy): Promise<Hex> {
    const values = {
      op_id: input.opId,
      owner_hash: input.ownerHash,
      policy: input.policy,
      policy_version: input.policyVersion,
      signature_hash: input.signatureHash,
      accepted_at: u64(input.acceptedAt),
    };
    const options = { expiration: ExpirationTime.max(), flags: { readonly: true } };
    const result = await this.writer.execute(
      { opId: input.opId as Hex, kind: "policy_acceptance" },
      (wallet) => wallet.createEntity(PolicyAcceptanceSchema, values, options),
      (wallet, params) => wallet.createEntity(PolicyAcceptanceSchema, values, options, params),
    );
    return result.entityKey;
  }

  async findPolicy(ownerHash: string, policy: PolicyName) {
    const page = await this.select(PolicyAcceptanceSchema)
      .where(and(eq("owner_hash", ownerHash), eq("policy", policy)))
      .limit(1)
      .fetch();
    const row = page.entities[0] as never as AnyRow | undefined;
    return row ? toPolicy(row) : undefined;
  }

  async createMember(input: NewMember): Promise<Hex> {
    const values = {
      op_id: input.opId,
      owner_hash: input.ownerHash,
      nullifier_hash: input.nullifierHash,
      ens_name: input.ensName,
      proof_ref: input.proofRef,
      join_policy_key: input.joinPolicyKey,
      joined_at: u64(input.joinedAt),
    };
    const options = { expiration: ExpirationTime.max(), flags: { readonly: true } };
    const result = await this.writer.execute(
      { opId: input.opId as Hex, kind: "member" },
      (wallet) => wallet.createEntity(MemberSchema, values, options),
      (wallet, params) => wallet.createEntity(MemberSchema, values, options, params),
    );
    return result.entityKey;
  }

  async getMember(key: Hex) {
    const page = await this.select(MemberSchema).where(eq("$key", keyValue(key))).limit(1).fetch();
    const row = page.entities[0] as never as AnyRow | undefined;
    return row ? toMember(row) : undefined;
  }

  async findMemberByOwner(ownerHash: string) {
    const row = await this.first(MemberSchema, "owner_hash", ownerHash);
    return row ? toMember(row) : undefined;
  }

  async findMemberByNullifier(nullifierHash: string) {
    const row = await this.first(MemberSchema, "nullifier_hash", nullifierHash);
    return row ? toMember(row) : undefined;
  }

  async findMemberByEns(ensName: string) {
    const row = await this.first(MemberSchema, "ens_name", ensName);
    return row ? toMember(row) : undefined;
  }

  async createDocket(input: NewDocket): Promise<Hex> {
    const values = {
      op_id: input.opId,
      owner_hash: input.ownerHash,
      ens_name: input.ensName,
      status: input.status,
      credential_level: input.credentialLevel,
      deadline: u64(input.deadline),
      created_at: u64(input.createdAt),
      title: input.title,
      body: stringToBytes(JSON.stringify({ question: input.question, topics: input.topics })),
    };
    // Mutable on purpose: status, ruling and swarm_ref change as the case concludes.
    const options = { expiration: ExpirationTime.atDate(input.expiresOn) };
    const result = await this.writer.execute(
      { opId: input.opId as Hex, kind: "docket" },
      (wallet) => wallet.createEntity(DocketSchema, values, options),
      (wallet, params) => wallet.createEntity(DocketSchema, values, options, params),
    );
    return result.entityKey;
  }

  async getDocket(key: Hex) {
    const page = await this.select(DocketSchema).where(eq("$key", keyValue(key))).limit(1).fetch();
    const row = page.entities[0] as never as AnyRow | undefined;
    return row ? toDocket(row) : undefined;
  }

  async findDocketByEns(ensName: string) {
    const row = await this.first(DocketSchema, "ens_name", ensName);
    return row ? toDocket(row) : undefined;
  }

  async listDockets(status?: DocketStatus) {
    const rows = await this.all(DocketSchema, status ? eq("status", status) : undefined);
    return rows.map(toDocket).sort((a, b) => Number(b.createdAt - a.createdAt));
  }

  async patchDocket(key: Hex, patch: DocketPatch): Promise<void> {
    const set = {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.ruling !== undefined ? { ruling: stringToBytes(patch.ruling) } : {}),
      ...(patch.rulingHash ? { ruling_hash: patch.rulingHash } : {}),
      ...(patch.closedAt !== undefined ? { closed_at: u64(patch.closedAt) } : {}),
      ...(patch.swarmRef ? { swarm_ref: patch.swarmRef } : {}),
    };
    await this.writer.execute(
      { opId: patch.opId as Hex, kind: "docket_patch" },
      (wallet) => wallet.patchEntity(DocketSchema, key, { set }),
      (wallet, params) => wallet.patchEntity(DocketSchema, key, { set }, params),
    );
  }

  async createComment(input: NewComment): Promise<Hex> {
    const values = {
      op_id: input.opId,
      docket_key: input.docketKey,
      topic: input.topic,
      owner_hash: input.ownerHash,
      author_type: input.authorType,
      sentiment: input.sentiment,
      submitted_at: u64(input.submittedAt),
      ens_name: input.ensName,
      author_ens: input.authorEns,
      proof_ref: input.proofRef,
      ordinal: i32(input.ordinal),
      stance_hash: input.stanceHash,
      stance: stringToBytes(input.stance),
    };
    // Readonly: a comment can never be edited after it posts. Expires with its docket (FR7).
    const options = {
      expiration: ExpirationTime.atBlock(input.expiresAtBlock),
      flags: { readonly: true },
    };
    const result = await this.writer.execute(
      { opId: input.opId as Hex, kind: "comment" },
      (wallet) => wallet.createEntity(CommentSchema, values, options),
      (wallet, params) => wallet.createEntity(CommentSchema, values, options, params),
    );
    return result.entityKey;
  }

  async findCommentByOp(opId: string) {
    const row = await this.first(CommentSchema, "op_id", opId);
    return row ? toComment(row) : undefined;
  }

  async listComments(docketKey: string) {
    const rows = await this.all(CommentSchema, eq("docket_key", docketKey));
    return rows.map(toComment).sort((a, b) => Number(a.submittedAt - b.submittedAt));
  }

  async countComments(docketKey: string) {
    const total = await this.reader.count().from(CommentSchema).createdBy(this.publisher)
      .where(eq("docket_key", docketKey)).fetch();
    return Number(total);
  }

  async countMemberComments(docketKey: string, ownerHash: string, topic: string) {
    const total = await this.reader.count().from(CommentSchema).createdBy(this.publisher)
      .where(and(eq("docket_key", docketKey), eq("owner_hash", ownerHash), eq("topic", topic))).fetch();
    return Number(total);
  }

  async stats(): Promise<Stats> {
    const count = (schema: Schema) => this.reader.count().from(schema).createdBy(this.publisher).fetch();
    const [members, dockets, comments] = await Promise.all([count(MemberSchema), count(DocketSchema), count(CommentSchema)]);
    return { members: Number(members), dockets: Number(dockets), comments: Number(comments) };
  }

  /** Used at startup to settle journal entries left unresolved by a crash. */
  async opExists(opId: Hex): Promise<boolean> {
    for (const schema of [MemberSchema, PolicyAcceptanceSchema, DocketSchema, CommentSchema]) {
      if (await this.first(schema, "op_id", opId)) return true;
    }
    return false;
  }
}

