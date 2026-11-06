import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DraftStatus, Sentiment, WorldCredential } from "./shared";

/**
 * World-gate state only: one-time request records, replay guards, agent drafts and
 * Agent Pass attempts. The durable public record (members, comments) lives on Arkiv
 * via the WorldGateHost — nothing here is the source of truth for the tally.
 */

export interface PendingRequest {
  nonce: string;
  purpose: "join" | "comment";
  action: string;
  signal: string;
  credential: WorldCredential;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  // join
  handle?: string;
  wallet?: string;
  // comment
  memberRef?: string;
  docketKey?: string;
  topic?: string;
  text?: string;
  sentiment?: Sentiment;
}

export interface NullifierRecord {
  action: string;
  nullifier: string;
  purpose: "join" | "comment";
  memberRef?: string;
  reservedAt: number;
}

export interface MemberLink {
  memberRef: string;
  ensName: string;
  /** World IdP account linked on first Agent Pass step-up: `(iss, sub)`. */
  idp?: { iss: string; sub: string };
}

export interface AgentTokenRecord {
  memberRef: string;
  label: string;
  createdAt: number;
}

export interface DraftRecord {
  draftKey: string;
  memberRef: string;
  docketKey: string;
  topic: string;
  text: string;
  sentiment: Sentiment;
  draftHash: string;
  revision: number;
  status: DraftStatus;
  discardReason?: string;
  createdAt: number;
  expiresAt: number;
  confirmState?: string;
  confirmExpiresAt?: number;
  posted?: { commentRef: string; ensName: string; proofRef: string };
}

export interface AgentPassAttempt {
  state: string;
  memberRef: string;
  draftKey: string;
  /** The draft hash the human is being asked to approve, frozen at start. */
  draftHash: string;
  /** OIDC nonce = sha256b64url(draftHash:salt): the World-signed ID token commits to the draft. */
  nonce: string;
  nonceSalt: string;
  pkceVerifier: string;
  startedAt: number;
  expiresAt: number;
  status: "open" | "used";
  outcome?: string;
}

export interface CommentSlot {
  proofRef: string;
  authorType: "human" | "agent";
  claimedAt: number;
}

interface Data {
  requests: Record<string, PendingRequest>;
  /** One counted comment per member per topic per docket (FR4), across both paths. */
  commentSlots: Record<string, CommentSlot>;
  nullifiers: Record<string, NullifierRecord>;
  members: Record<string, MemberLink>;
  idpLinks: Record<string, string>;
  agentTokens: Record<string, AgentTokenRecord>;
  drafts: Record<string, DraftRecord>;
  attempts: Record<string, AgentPassAttempt>;
}

const empty = (): Data => ({
  requests: {},
  commentSlots: {},
  nullifiers: {},
  members: {},
  idpLinks: {},
  agentTokens: {},
  drafts: {},
  attempts: {},
});

export class WorldStore {
  readonly data: Data;

  /** `file: null` keeps everything in memory (tests). */
  constructor(private readonly file: string | null) {
    this.data = empty();
    if (file) {
      try {
        Object.assign(this.data, JSON.parse(readFileSync(file, "utf8")));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }

  /** Every mutation goes through here; Node is single-threaded so each call is atomic. */
  mutate<T>(fn: (d: Data) => T): T {
    const out = fn(this.data);
    this.flush();
    return out;
  }

  private flush() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}

export const nullifierKey = (action: string, nullifier: string) => `${action}|${nullifier}`;
export const slotKey = (memberRef: string, docketKey: string, topic: string) => `${memberRef}|${docketKey}|${topic}`;
export const idpKey =(iss: string, sub: string) => `${iss}|${sub}`;
