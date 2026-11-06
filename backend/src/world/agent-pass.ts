import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from "openid-client";
import type { AgentConfirmed } from "../shared";
import type { Deps } from "../deps";
import { GateError } from "../errors";
import { randomToken, sha256B64url, sha256Hex } from "../crypto";
import { idpKey, type DraftRecord } from "../store";
import { discardDraft, getOwnDraft } from "./drafts";
import { assertSlotFree, postComment } from "./comment-gate";

/**
 * World ID Agent Pass gate for agent-drafted comments (FR6).
 *
 * The human approves one exact draft, freshly, via a World IdP step-up
 * (max_age=0, essential acr). The attempt is frozen to the draft's hash at start, and
 * the OIDC nonce is derived from that hash, so the World-signed ID token itself commits
 * to the words being approved. Any failure — cancel, expiry, a changed draft, a
 * different World account — discards the draft. Nothing posts.
 */

/** Allowed drift for auth_time vs. our clock. */
const CLOCK_SKEW_SECONDS = 10;

const commitNonce = (hash: string, salt: string) => sha256B64url(`commentdesk:agentpass:v1|${hash}|${salt}`);

export async function startAgentConfirm(deps: Deps, memberRef: string, draftKey: string): Promise<URL> {
  const { store, config, now } = deps;
  const draft = getOwnDraft(deps, memberRef, draftKey);
  if (draft.status !== "pending" && draft.status !== "confirming") {
    throw new GateError(`draft_${draft.status}`, `Draft is already ${draft.status}.`, 409);
  }
  const docket = await deps.host.getDocket(draft.docketKey);
  if (!docket || docket.status !== "open" || docket.deadline <= now()) {
    throw new GateError("docket_closed", "This docket is closed to new comments.");
  }
  assertSlotFree(deps, draft);

  const state = randomToken(24);
  const nonceSalt = randomToken(16);
  const pkceVerifier = randomPKCECodeVerifier();
  const startedAt = now();
  const expiresAt = Math.min(startedAt + config.AGENT_PASS_CONFIRM_TTL_SECONDS, docket.deadline);
  const nonce = commitNonce(draft.draftHash, nonceSalt);

  store.mutate((d) => {
    // Restarting supersedes the earlier attempt; its callback will no longer match.
    if (draft.confirmState && d.attempts[draft.confirmState]) {
      d.attempts[draft.confirmState].status = "used";
      d.attempts[draft.confirmState].outcome = "superseded";
    }
    d.attempts[state] = {
      state,
      memberRef,
      draftKey,
      draftHash: draft.draftHash,
      nonce,
      nonceSalt,
      pkceVerifier,
      startedAt,
      expiresAt,
      status: "open",
    };
    const rec = d.drafts[draftKey];
    rec.status = "confirming";
    rec.confirmState = state;
    rec.confirmExpiresAt = expiresAt;
  });

  return deps.oidc.authorizationUrl({
    state,
    nonce,
    codeChallenge: await calculatePKCECodeChallenge(pkceVerifier),
    acrValues: config.AGENT_PASS_ACR_VALUES,
    requiredSub: store.data.members[memberRef]?.idp?.sub,
  });
}

export type ConfirmOutcome =
  | { ok: true; draft: DraftRecord }
  | { ok: false; reason: string; message: string; draft?: DraftRecord };

export async function completeAgentConfirm(
  deps: Deps,
  callbackUrl: URL,
  sessionMemberRef: string | null,
): Promise<ConfirmOutcome> {
  const { store, config, now } = deps;
  const state = callbackUrl.searchParams.get("state") ?? "";
  const attempt = store.data.attempts[state];
  if (!attempt) return { ok: false, reason: "unknown_state", message: "This confirmation wasn't started here." };
  if (attempt.status !== "open") {
    return { ok: false, reason: "confirm_replayed", message: "This confirmation was already used." };
  }
  // One shot: whatever happens next, this attempt can't authorize anything again.
  store.mutate((d) => {
    d.attempts[state].status = "used";
  });

  const fail = (reason: string, message: string): ConfirmOutcome => {
    discardDraft(deps, attempt.draftKey, reason);
    store.mutate((d) => {
      d.attempts[state].outcome = reason;
    });
    return { ok: false, reason, message, draft: store.data.drafts[attempt.draftKey] };
  };

  if (sessionMemberRef !== attempt.memberRef) {
    return fail("session_mismatch", "The confirmation came back to a different session than the one that started it.");
  }
  const idpError = callbackUrl.searchParams.get("error");
  if (idpError) {
    return idpError === "access_denied"
      ? fail("cancelled", "You cancelled the World ID confirmation. The agent's draft was discarded.")
      : fail(`idp_${idpError}`, callbackUrl.searchParams.get("error_description") ?? `World ID returned ${idpError}.`);
  }
  if (now() > attempt.expiresAt) {
    return fail("confirm_expired", "The confirmation window closed before you finished. The draft was discarded.");
  }

  let claims;
  try {
    claims = await deps.oidc.redeem(callbackUrl, {
      state,
      nonce: attempt.nonce,
      pkceVerifier: attempt.pkceVerifier,
    });
  } catch (err) {
    return fail("token_invalid", `World ID response failed validation: ${(err as Error).message}`);
  }

  if (claims.iss !== deps.oidc.issuer()) return fail("issuer_mismatch", "Unexpected World ID issuer.");
  if (!config.AGENT_PASS_ACR_VALUES.includes(claims.acr)) {
    return fail("acr_insufficient", `World ID authenticated at "${claims.acr || "unknown"}", which this action doesn't accept.`);
  }
  if (
    !Number.isFinite(claims.auth_time) ||
    claims.auth_time < attempt.startedAt - CLOCK_SKEW_SECONDS ||
    claims.auth_time > now() + CLOCK_SKEW_SECONDS
  ) {
    return fail("not_fresh", "World ID didn't perform a fresh authentication for this approval.");
  }

  const link = store.data.members[attempt.memberRef];
  const linkedTo = store.data.idpLinks[idpKey(claims.iss, claims.sub)];
  if (link?.idp && (link.idp.iss !== claims.iss || link.idp.sub !== claims.sub)) {
    return fail("identity_mismatch", "A different World ID account approved this than the one linked to your membership.");
  }
  if (!link?.idp && linkedTo && linkedTo !== attempt.memberRef) {
    return fail("identity_linked_elsewhere", "That World ID account is already linked to another member.");
  }

  const draft = store.data.drafts[attempt.draftKey];
  if (!draft || draft.status !== "confirming" || draft.confirmState !== state) {
    return fail("draft_not_confirming", "The draft is no longer awaiting this confirmation.");
  }
  // The token's nonce commits to the hash at start; recompute it from the draft as it is *now*.
  if (draft.draftHash !== attempt.draftHash || claims.nonce !== commitNonce(draft.draftHash, attempt.nonceSalt)) {
    return fail("draft_changed", "The draft changed after you were asked to approve it. Nothing was posted.");
  }
  const docket = await deps.host.getDocket(draft.docketKey);
  if (!docket || docket.status !== "open" || docket.deadline <= now()) {
    return fail("docket_closed", "The docket closed before the comment could post.");
  }

  const proof: AgentConfirmed = {
    agentConfirmed: true,
    draftKey: draft.draftKey,
    draftHash: draft.draftHash,
    proofRef: `agentpass:${sha256Hex(`${claims.iss}|${claims.jti ?? state}`)}`,
    acr: claims.acr,
    authTime: claims.auth_time,
    verifiedAt: now(),
  };

  let created;
  try {
    created = await postComment(deps, proof, {
      memberRef: attempt.memberRef,
      docketKey: draft.docketKey,
      topic: draft.topic,
      text: draft.text,
      sentiment: draft.sentiment,
      authorType: "agent",
    });
  } catch (err) {
    return fail((err as GateError).reason ?? "post_failed", (err as Error).message);
  }

  store.mutate((d) => {
    if (!link?.idp) {
      d.members[attempt.memberRef] = {
        ...(d.members[attempt.memberRef] ?? { memberRef: attempt.memberRef, ensName: "" }),
        idp: { iss: claims.iss, sub: claims.sub },
      };
      d.idpLinks[idpKey(claims.iss, claims.sub)] = attempt.memberRef;
    }
    const rec = d.drafts[draft.draftKey];
    rec.status = "posted";
    rec.confirmState = undefined;
    rec.posted = { ...created, proofRef: proof.proofRef };
    d.attempts[state].outcome = "posted";
  });
  return { ok: true, draft: store.data.drafts[draft.draftKey] };
}
