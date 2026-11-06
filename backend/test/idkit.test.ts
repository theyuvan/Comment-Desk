import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorldRequest } from "../src/world/idkit";
import { submitHumanComment, submitJoin } from "../src/world/comment-gate";
import { GateError } from "../src/errors";
import { fakeIdkitResult, makeDeps } from "./world-helpers";

const reason = (r: string) => (err: unknown) => err instanceof GateError && err.reason === r;

async function joined(ctx = makeDeps(), nullifier = "111") {
  const req = await createWorldRequest(ctx.deps, { purpose: "join", handle: "maya" }, null);
  const member = await submitJoin(ctx.deps, fakeIdkitResult(req, { nullifier }));
  return { ...ctx, member };
}

const comment = { purpose: "comment", docketKey: "truck-emissions-rule", topic: "enforcement" } as const;

test("join: valid proof creates exactly one member; same human again signs back in", async () => {
  const ctx = await joined();
  assert.equal(ctx.member.ensName, "maya.commentdesk.eth");
  assert.equal(ctx.member.returning, false);

  const again = await createWorldRequest(ctx.deps, { purpose: "join", handle: "maya-two" }, null);
  const second = await submitJoin(ctx.deps, fakeIdkitResult(again, { nullifier: "111" }));
  assert.equal(second.returning, true);
  assert.equal(second.memberRef, ctx.member.memberRef);
  assert.equal(ctx.host.members.size, 1, "no second identity for the same human (FR1)");
});

test("join: request is signed server-side for the join action with the configured credential", async () => {
  const { deps } = makeDeps();
  const req = await createWorldRequest(deps, { purpose: "join", handle: "maya" }, null);
  assert.equal(req.action, "commentdesk-join");
  assert.equal(req.credential, "proof_of_human");
  assert.match(req.rp_context.signature, /^0x[0-9a-f]+$/);
  await assert.rejects(createWorldRequest(deps, { purpose: "join", handle: "No!" }, null), reason("invalid_handle"));
});

test("human comment: posts the server-held text with author type human", async () => {
  const ctx = await joined();
  const req = await createWorldRequest(ctx.deps, { ...comment, text: "Enforce it." }, ctx.member.memberRef);
  assert.equal(req.require_user_presence, true);
  const created = await submitHumanComment(ctx.deps, fakeIdkitResult(req, { nullifier: "222" }), ctx.member.memberRef);
  assert.match(created.ensName, /^comment-1\.truck-emissions-rule\./);
  assert.equal(ctx.host.comments[0].authorType, "human");
  assert.equal(ctx.host.comments[0].text, "Enforce it.");
});

test("human comment DENIED: nullifier reuse on the same docket topic is blocked", async () => {
  const ctx = await joined();
  const first = await createWorldRequest(ctx.deps, { ...comment, text: "First." }, ctx.member.memberRef);
  await submitHumanComment(ctx.deps, fakeIdkitResult(first, { nullifier: "222" }), ctx.member.memberRef);

  const second = await createWorldRequest(ctx.deps, { ...comment, text: "Second." }, ctx.member.memberRef);
  await assert.rejects(
    submitHumanComment(ctx.deps, fakeIdkitResult(second, { nullifier: "222" }), ctx.member.memberRef),
    reason("nullifier_reused"),
  );
  assert.equal(ctx.host.comments.length, 1);
});

test("human comment DENIED: proof bound to different text than the request", async () => {
  const ctx = await joined();
  const req = await createWorldRequest(ctx.deps, { ...comment, text: "Real words." }, ctx.member.memberRef);
  const swapped = fakeIdkitResult(req, { signal: req.signal.replace(/[0-9a-f]{64}$/, "0".repeat(64)) });
  await assert.rejects(submitHumanComment(ctx.deps, swapped, ctx.member.memberRef), reason("signal_mismatch"));
  assert.equal(ctx.portal.calls, 1, "only the join proof reached the portal");
  assert.equal(ctx.host.comments.length, 0);
});

test("human comment DENIED: expired request, replayed request, wrong environment", async () => {
  const ctx = await joined();
  const staging = await createWorldRequest(ctx.deps, { ...comment, text: "Sim." }, ctx.member.memberRef);
  await assert.rejects(
    submitHumanComment(ctx.deps, fakeIdkitResult(staging, { environment: "staging" }), ctx.member.memberRef),
    reason("wrong_environment"),
  );

  const expired = await createWorldRequest(ctx.deps, { ...comment, text: "Late." }, ctx.member.memberRef);
  ctx.advance(ctx.deps.config.WORLD_ID_REQUEST_TTL_SECONDS + 1);
  await assert.rejects(submitHumanComment(ctx.deps, fakeIdkitResult(expired), ctx.member.memberRef), reason("request_expired"));
  await assert.rejects(submitHumanComment(ctx.deps, fakeIdkitResult(expired), ctx.member.memberRef), reason("request_replayed"));
  assert.equal(ctx.host.comments.length, 0);
});

test("human comment DENIED: World portal rejects the proof; no nullifier is burned", async () => {
  const ctx = await joined();
  ctx.portal.verdict = { success: false, code: "all_verifications_failed", detail: "All proof verifications failed." };
  const req = await createWorldRequest(ctx.deps, { ...comment, text: "Hi." }, ctx.member.memberRef);
  await assert.rejects(submitHumanComment(ctx.deps, fakeIdkitResult(req, { nullifier: "9" }), ctx.member.memberRef), reason("proof_invalid"));
  assert.equal(Object.values(ctx.deps.store.data.nullifiers).filter((n) => n.purpose === "comment").length, 0);
});

test("human comment DENIED: soft docket asks for Selfie Check; an Orb response for it is refused", async () => {
  const ctx = await joined();
  const req = await createWorldRequest(
    ctx.deps,
    { purpose: "comment", docketKey: "community-garden-hours", topic: "opening-hours", text: "Yes." },
    ctx.member.memberRef,
  );
  assert.equal(req.credential, "selfie");
  assert.equal(req.allow_legacy_proofs, false);
  await assert.rejects(
    submitHumanComment(ctx.deps, fakeIdkitResult(req, { identifier: "proof_of_human" }), ctx.member.memberRef),
    reason("credential_mismatch"),
  );
});

test("human comment DENIED: a proof started in one session can't be redeemed by another", async () => {
  const ctx = await joined();
  const req = await createWorldRequest(ctx.deps, { ...comment, text: "Mine." }, ctx.member.memberRef);
  await assert.rejects(submitHumanComment(ctx.deps, fakeIdkitResult(req), "member_someone_else"), reason("session_mismatch"));
});
