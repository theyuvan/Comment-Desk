/**
 * The join point between the World ID half and the Arkiv/ENS half.
 *
 * World code (backend/src/world/*) runs every proof check, then calls exactly one
 * method on a `WorldGateHost`. It never touches Arkiv or ENS. The Arkiv/ENS code
 * implements `WorldGateHost` and never calls IDKit or Agent Pass.
 *
 * Everything in these result objects is safe to write into a public Arkiv entity:
 * nullifiers are RP+action scoped by design, and proof refs are hashes, not tokens.
 */

/** World ID credential a gate asked for. Mirrors IDKit 4 `CredentialType` names. */
export type WorldCredential = "proof_of_human" | "selfie";

/** Per-docket credential level set by the Creator (README "Access control"). */
export type DocketCredentialLevel = "strict" | "soft";

export const CREDENTIAL_FOR_LEVEL: Record<DocketCredentialLevel, WorldCredential> = {
  strict: "proof_of_human",
  soft: "selfie",
};

export type AuthorType = "human" | "agent";

/** Result of a server-validated IDKit proof (join, or a human-typed comment). */
export interface HumanVerified {
  humanVerified: true;
  purpose: "join" | "comment";
  /** `idkit:<protocol>:<sha256(action|nullifier)>` — stable, public-safe. */
  proofRef: string;
  /** RP+action scoped nullifier, decimal string. */
  nullifier: string;
  action: string;
  /** The exact signal string the proof was bound to. */
  signal: string;
  credential: WorldCredential;
  environment: "production" | "staging";
  verifiedAt: number;
}

/** Result of a validated, draft-scoped Agent Pass step-up. */
export interface AgentConfirmed {
  agentConfirmed: true;
  draftKey: string;
  /** sha256 of the canonical draft the human approved; the ID token nonce commits to it. */
  draftHash: string;
  /** `agentpass:<sha256(iss|jti)>` — stable, public-safe. */
  proofRef: string;
  /** `acr` the World IdP asserted, e.g. https://world.org/oidc/acr/orb */
  acr: string;
  authTime: number;
  verifiedAt: number;
}

export type CommentProof = (HumanVerified & { purpose: "comment" }) | AgentConfirmed;

export interface JoinRequest {
  /** Requested ENS label, e.g. "maya" for maya.commentdesk.eth. */
  handle: string;
  /** Wallet that will own the ENS name / hashed Arkiv owner. Bound into the proof signal. */
  wallet?: string;
}

export interface CommentSubmission {
  memberRef: string;
  docketKey: string;
  topic: string;
  text: string;
  authorType: AuthorType;
  /** The position the human proved or approved. Bound into the World signal / draft hash. */
  sentiment: Sentiment;
}

/** A counted comment's position. Part of what the human proves or approves. */
export type Sentiment = "support" | "oppose" | "neutral";
export const SENTIMENTS: readonly Sentiment[] = ["support", "oppose", "neutral"];

export interface DocketInfo {
  key: string;
  title: string;
  /** The question being consulted on, so an agent can draft against it. */
  question?: string;
  topics: string[];
  credentialLevel: DocketCredentialLevel;
  status: "open" | "closed";
  /** Unix seconds. */
  deadline: number;
  /** Resolvable ENS name of the docket, if minted. */
  ensName?: string;
}

/** Counted comments per topic so far. Aggregate only: no authors, no text. */
export interface DocketInsight {
  counted: number;
  topics: { topic: string; support: number; oppose: number; neutral: number; human: number; agent: number }[];
}

/** Implemented by the Arkiv/ENS half. */
export interface WorldGateHost {
  /**
   * Called once per human, after the join proof validated and its nullifier was reserved.
   * Mint the member's ENS subname and write the `member` entity here.
   * Throw to reject (e.g. handle taken); the nullifier reservation is then released.
   */
  onMemberVerified(proof: HumanVerified & { purpose: "join" }, join: JoinRequest): Promise<MemberCreated>;

  /**
   * Called once per comment, after either gate passed. Mint the comment subname and
   * write the `comment` entity with `submission.authorType` here.
   */
  onCommentVerified(proof: CommentProof, submission: CommentSubmission): Promise<CommentCreated>;

  /** Optional: the docket's live counted tally, which the drafting agent may show as context. */
  getInsight?(docketKey: string): Promise<DocketInsight | null>;

  getDocket(docketKey: string): Promise<DocketInfo | null>;
}

export interface MemberCreated {
  /** Stable member id used in sessions; the Arkiv `member` entity key. */
  memberRef: string;
  ensName: string;
  /** The host recognised this human as an existing member, so nothing new was created. */
  returning?: boolean;
}

export interface CommentCreated {
  commentRef: string;
  ensName: string;
}

export function isAgentConfirmed(proof: CommentProof): proof is AgentConfirmed {
  return "agentConfirmed" in proof;
}
