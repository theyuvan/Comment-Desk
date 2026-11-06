/** Request/response shapes shared by backend routes and frontend World widgets. */
import type { DocketInfo, Sentiment, WorldCredential } from "./world-gate";

export interface RpContextDto {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** POST /api/world/requests — the backend decides action, signal and credential. */
export type WorldRequestInput =
  | { purpose: "join"; handle: string; wallet?: string }
  | { purpose: "comment"; docketKey: string; topic: string; text: string; sentiment?: Sentiment };

export interface WorldRequestDto {
  app_id: `app_${string}`;
  action: string;
  action_description: string;
  signal: string;
  credential: WorldCredential;
  environment: "production" | "staging";
  allow_legacy_proofs: boolean;
  require_user_presence: boolean;
  rp_context: RpContextDto;
}

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. "nullifier_reused", "draft_changed". */
  reason: string;
}

export interface SessionDto {
  memberRef: string;
  ensName: string;
  worldLinked: boolean;
}

export type DraftStatus = "pending" | "confirming" | "posted" | "discarded";

export interface DraftDto {
  draftKey: string;
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
  /** Set while status = "confirming". */
  confirmExpiresAt?: number;
  posted?: { commentRef: string; ensName: string };
}

export type { DocketInfo };
