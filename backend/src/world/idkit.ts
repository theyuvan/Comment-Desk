import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { Nullifier } from "@worldcoin/idkit-core";
import {
  CREDENTIAL_FOR_LEVEL,
  type HumanVerified,
  type WorldCredential,
  type WorldRequestDto,
  type WorldRequestInput,
} from "@commentdesk/shared";
import type { Deps } from "../deps";
import { GateError } from "../errors";
import { draftHash, sha256Hex } from "../crypto";
import { nullifierKey, type PendingRequest } from "../store";

/**
 * IDKit 4 gate: used for the member-join proof and for human-typed comments.
 *
 * The backend — never the client — decides action, signal and credential, signs the
 * RP context, and remembers what it asked for under the RP nonce. A result is only
 * accepted if it answers that exact request.
 */

export const JOIN_ACTION = "commentdesk-join";

/** One action per (docket, topic): its nullifier is "this human already commented here". */
export function commentAction(docketKey: string, topic: string): string {
  return `commentdesk-comment-${sha256Hex(`${docketKey}|${topic}`).slice(0, 40)}`;
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
export const MAX_COMMENT_CHARS = 4000;

/** v4 identifiers per credential, plus the v3 identifier the ProofOfHuman preset may fall back to. */
const ACCEPTED_IDENTIFIERS: Record<WorldCredential, { v4: string; v3: string[] }> = {
  proof_of_human: { v4: "proof_of_human", v3: ["orb"] },
  selfie: { v4: "selfie", v3: [] },
};

export async function createWorldRequest(
  deps: Deps,
  input: WorldRequestInput,
  memberRef: string | null,
): Promise<WorldRequestDto> {
  const { config, store, now } = deps;
  let req: Omit<PendingRequest, "nonce" | "createdAt" | "expiresAt">;
  let description: string;

  if (input.purpose === "join") {
    const handle = input.handle.trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) {
      throw new GateError("invalid_handle", "Handle must be 3–32 chars: lowercase letters, digits, hyphens.");
    }
    const wallet = input.wallet?.toLowerCase();
    if (wallet !== undefined && !/^0x[0-9a-f]{40}$/.test(wallet)) {
      throw new GateError("invalid_wallet", "Wallet must be a 0x-prefixed 20-byte address.");
    }
    req = {
      purpose: "join",
      action: JOIN_ACTION,
      signal: `commentdesk:join:v1|${handle}|${wallet ?? ""}`,
      credential: config.WORLD_ID_JOIN_CREDENTIAL,
      handle,
      wallet,
    };
    description = `Join Comment Desk as ${handle}.commentdesk.eth (one name per human)`;
  } else {
    if (!memberRef) throw new GateError("not_a_member", "Join Comment Desk before commenting.", 401);
    const docket = await deps.host.getDocket(input.docketKey);
    if (!docket) throw new GateError("unknown_docket", "No such docket.", 404);
    if (docket.status !== "open" || docket.deadline <= now()) {
      throw new GateError("docket_closed", "This docket is closed to new comments.");
    }
    if (!docket.topics.includes(input.topic)) throw new GateError("unknown_topic", "That topic is not on this docket.");
    const text = input.text.trim();
    if (!text || text.length > MAX_COMMENT_CHARS) {
      throw new GateError("invalid_text", `Comment must be 1–${MAX_COMMENT_CHARS} characters.`);
    }
    req = {
      purpose: "comment",
      action: commentAction(docket.key, input.topic),
      // Binds the proof to this member and to the exact words being posted.
      signal: `commentdesk:comment:v1|${memberRef}|${draftHash(docket.key, input.topic, text)}`,
      credential: CREDENTIAL_FOR_LEVEL[docket.credentialLevel],
      memberRef,
      docketKey: docket.key,
      topic: input.topic,
      text,
      sentiment: input.sentiment,
    };
    description = `Post your comment on "${docket.title}" (topic: ${input.topic})`;
  }

  const sig = signRequest({
    signingKeyHex: config.WORLD_ID_SIGNING_KEY,
    action: req.action,
    ttl: config.WORLD_ID_REQUEST_TTL_SECONDS,
  });

  store.mutate((d) => {
    d.requests[sig.nonce] = { ...req, nonce: sig.nonce, createdAt: sig.createdAt, expiresAt: sig.expiresAt };
  });

  return {
    app_id: config.WORLD_ID_APP_ID as `app_${string}`,
    action: req.action,
    action_description: description,
    signal: req.signal,
    credential: req.credential,
    environment: config.WORLD_ID_ENVIRONMENT,
    // Selfie Check is v4-only; legacy fallback only ever applies to Proof of Human.
    allow_legacy_proofs: req.credential === "proof_of_human" && config.WORLD_ID_ALLOW_LEGACY_PROOFS,
    // A human-typed comment must come from someone present right now, not a replayed session.
    require_user_presence: req.purpose === "comment",
    rp_context: {
      rp_id: config.WORLD_ID_RP_ID,
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig,
    },
  };
}

interface IdkitResponseItem {
  identifier: string;
  signal_hash?: string;
  nullifier?: string;
}

interface IdkitResultLike {
  protocol_version?: string;
  nonce?: string;
  action?: string;
  session_id?: string;
  environment?: string;
  user_presence_completed?: boolean;
  responses?: IdkitResponseItem[];
}

function sameField(a: string | undefined, b: string): boolean {
  try {
    return a !== undefined && BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function normalizeNullifier(protocol: string, raw: string): string {
  // v4 nullifiers are decimal strings; v3 are hex. Store both as canonical decimal.
  if (protocol === "3.0") return Nullifier.fromHex(raw).toBigInt().toString();
  return BigInt(raw).toString();
}

/**
 * Validates an IDKit result against the request we issued, then against World's
 * Developer Portal. Returns the pending request (with text/handle the client can't
 * swap) and the HumanVerified proof. Reserves the nullifier atomically.
 */
export async function verifyWorldResult(
  deps: Deps,
  raw: unknown,
  memberRef: string | null,
): Promise<{ pending: PendingRequest; proof: HumanVerified; existingMemberRef?: string }> {
  const { config, store, now } = deps;
  const result = (raw ?? {}) as IdkitResultLike;

  const pending = result.nonce ? store.data.requests[result.nonce] : undefined;
  if (!pending) throw new GateError("unknown_request", "This proof doesn't answer a request we issued.");
  if (pending.usedAt) throw new GateError("request_replayed", "This verification was already used.");
  // One shot per request, even if a later check fails: the user starts a fresh one.
  store.mutate((d) => {
    d.requests[pending.nonce].usedAt = now();
  });
  if (now() > pending.expiresAt) throw new GateError("request_expired", "The verification request expired. Try again.");

  if (pending.purpose === "comment" && pending.memberRef !== memberRef) {
    throw new GateError("session_mismatch", "This verification was started by a different session.", 403);
  }
  if (result.environment !== config.WORLD_ID_ENVIRONMENT) {
    throw new GateError("wrong_environment", `Expected a ${config.WORLD_ID_ENVIRONMENT} proof.`);
  }
  if (result.session_id && !result.action) throw new GateError("session_proof", "A session proof can't authorize this action.");

  const protocol = result.protocol_version ?? "";
  const legacyOk = pending.credential === "proof_of_human" && config.WORLD_ID_ALLOW_LEGACY_PROOFS;
  if (protocol !== "4.0" && !(protocol === "3.0" && legacyOk)) {
    throw new GateError("unsupported_protocol", `World ID protocol ${protocol || "?"} is not accepted here.`);
  }
  if (protocol === "4.0" && result.action !== pending.action) {
    throw new GateError("action_mismatch", "The proof is for a different action.");
  }
  if (pending.purpose === "comment" && protocol === "4.0" && result.user_presence_completed === false) {
    throw new GateError("presence_failed", "World App didn't complete the presence check.");
  }

  const accepted = ACCEPTED_IDENTIFIERS[pending.credential];
  const ids = protocol === "4.0" ? [accepted.v4] : accepted.v3;
  const item = result.responses?.find((r) => ids.includes(r.identifier));
  if (!item?.nullifier) {
    throw new GateError("credential_mismatch", `This needs a ${pending.credential.replace(/_/g, " ")} credential.`);
  }
  if (!sameField(item.signal_hash, hashSignal(pending.signal))) {
    throw new GateError("signal_mismatch", "The proof is bound to different content than what's being submitted.");
  }

  const verdict = await deps.portal.verify(raw);
  if (!verdict.success || (verdict.environment && verdict.environment !== config.WORLD_ID_ENVIRONMENT)) {
    throw new GateError("proof_invalid", verdict.detail ?? "World ID rejected the proof.", 401);
  }

  const nullifier = normalizeNullifier(protocol, item.nullifier);
  const key = nullifierKey(pending.action, nullifier);
  const prior = store.data.nullifiers[key];
  const proof: HumanVerified = {
    humanVerified: true,
    purpose: pending.purpose,
    proofRef: `idkit:${protocol}:${sha256Hex(key)}`,
    nullifier,
    action: pending.action,
    signal: pending.signal,
    credential: pending.credential,
    environment: config.WORLD_ID_ENVIRONMENT,
    verifiedAt: now(),
  };

  if (prior) {
    if (pending.purpose === "join" && prior.memberRef) {
      // Same human again: sign them back in to their one identity rather than mint a second.
      return { pending, proof, existingMemberRef: prior.memberRef };
    }
    throw new GateError(
      "nullifier_reused",
      pending.purpose === "join"
        ? "This World ID already joined and is still being set up."
        : "You've already commented on this topic of this docket. One counted comment per human per topic.",
      409,
    );
  }
  store.mutate((d) => {
    d.nullifiers[key] = { action: pending.action, nullifier, purpose: pending.purpose, memberRef: memberRef ?? undefined, reservedAt: now() };
  });
  return { pending, proof };
}

export function releaseNullifier(deps: Deps, proof: HumanVerified) {
  deps.store.mutate((d) => {
    delete d.nullifiers[nullifierKey(proof.action, proof.nullifier)];
  });
}

export function bindNullifierToMember(deps: Deps, proof: HumanVerified, memberRef: string) {
  deps.store.mutate((d) => {
    const rec = d.nullifiers[nullifierKey(proof.action, proof.nullifier)];
    if (rec) rec.memberRef = memberRef;
  });
}
