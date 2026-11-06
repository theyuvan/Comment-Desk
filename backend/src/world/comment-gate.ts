import type { CommentCreated, CommentProof, CommentSubmission, HumanVerified, MemberCreated, JoinRequest } from "@commentdesk/shared";
import type { Deps } from "../deps";
import { GateError } from "../errors";
import { slotKey } from "../store";
import { bindNullifierToMember, releaseNullifier, verifyWorldResult } from "./idkit";

/**
 * The only two places World code hands a result to the Arkiv/ENS half:
 * `host.onMemberVerified` (join) and `host.onCommentVerified` (both comment paths).
 */

export function assertSlotFree(deps: Deps, s: Pick<CommentSubmission, "memberRef" | "docketKey" | "topic">) {
  if (deps.store.data.commentSlots[slotKey(s.memberRef, s.docketKey, s.topic)]) {
    throw new GateError(
      "already_commented",
      "You've already commented on this topic of this docket. One counted comment per human per topic.",
      409,
    );
  }
}

/**
 * Keeps the host's own refusal code (e.g. "already_commented", "handle_taken") so the user
 * sees why. Anything without one is reported as a failed write.
 */
function hostRefusal(err: unknown, fallback: string, prefix: string, status: number): GateError {
  const { code, status: hostStatus, message } = err as { code?: unknown; status?: unknown; message?: string };
  if (typeof code === "string" && typeof hostStatus === "number" && hostStatus < 500) {
    return new GateError(code, message ?? code, hostStatus);
  }
  return new GateError(fallback, `${prefix}: ${message ?? String(err)}`, status);
}

/** Claims the member's slot for this topic, hands off to the host, rolls back if the host fails. */
export async function postComment(
  deps: Deps,
  proof: CommentProof,
  submission: CommentSubmission,
  rollback: () => void = () => {},
): Promise<CommentCreated> {
  assertSlotFree(deps, submission);
  const key = slotKey(submission.memberRef, submission.docketKey, submission.topic);
  deps.store.mutate((d) => {
    d.commentSlots[key] = { proofRef: proof.proofRef, authorType: submission.authorType, claimedAt: deps.now() };
  });
  try {
    return await deps.host.onCommentVerified(proof, submission);
  } catch (err) {
    deps.store.mutate((d) => {
      delete d.commentSlots[key];
    });
    rollback();
    throw hostRefusal(err, "post_failed", "Verified, but recording the comment failed", 502);
  }
}

export async function submitJoin(
  deps: Deps,
  idkitResult: unknown,
): Promise<MemberCreated & { returning: boolean }> {
  const { pending, proof, existingMemberRef } = await verifyWorldResult(deps, idkitResult, null);
  if (existingMemberRef) {
    const link = deps.store.data.members[existingMemberRef];
    return { memberRef: existingMemberRef, ensName: link?.ensName ?? "", returning: true };
  }
  const join: JoinRequest = { handle: pending.handle!, wallet: pending.wallet };
  let created: MemberCreated;
  try {
    created = await deps.host.onMemberVerified(proof as HumanVerified & { purpose: "join" }, join);
  } catch (err) {
    releaseNullifier(deps, proof);
    throw hostRefusal(err, "join_failed", "Verified, but creating your identity failed", 502);
  }
  bindNullifierToMember(deps, proof, created.memberRef);
  deps.store.mutate((d) => {
    d.members[created.memberRef] = { memberRef: created.memberRef, ensName: created.ensName };
  });
  return { ...created, returning: created.returning ?? false };
}

export async function submitHumanComment(deps: Deps, idkitResult: unknown, memberRef: string | null) {
  if (!memberRef) throw new GateError("not_a_member", "Join Comment Desk before commenting.", 401);
  const { pending, proof } = await verifyWorldResult(deps, idkitResult, memberRef);
  const submission: CommentSubmission = {
    memberRef,
    docketKey: pending.docketKey!,
    topic: pending.topic!,
    // The text stored when the request was issued — the client can't swap it after proving.
    text: pending.text!,
    sentiment: pending.sentiment ?? "neutral",
    authorType: "human",
  };
  return postComment(deps, proof as HumanVerified & { purpose: "comment" }, submission, () =>
    releaseNullifier(deps, proof),
  );
}
