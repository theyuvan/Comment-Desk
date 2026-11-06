import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorldRequest } from "../src/world/idkit";
import { submitJoin } from "../src/world/comment-gate";
import { createDraft, editDraft, listDrafts } from "../src/world/drafts";
import { completeAgentConfirm, startAgentConfirm } from "../src/world/agent-pass";
import { GateError } from "../src/errors";
import { callbackUrl, fakeIdkitResult, makeDeps } from "./world-helpers";

async function withDraft(text = "Phase in over three years, not five.") {
  const ctx = makeDeps();
  const req = await createWorldRequest(ctx.deps, { purpose: "join", handle: "maya" }, null);
  const member = await submitJoin(ctx.deps, fakeIdkitResult(req, { nullifier: "111" }));
  const draft = await createDraft(ctx.deps, member.memberRef, {
    docketKey: "truck-emissions-rule",
    topic: "phase-in-timeline",
    text,
  });
  return { ...ctx, member, draft };
}

async function started(ctx: Awaited<ReturnType<typeof withDraft>>) {
  await startAgentConfirm(ctx.deps, ctx.member.memberRef, ctx.draft.draftKey);
  return ctx.idp.lastAuthorize!.state;
}

const draftOf = (ctx: Awaited<ReturnType<typeof withDraft>>) => ctx.deps.store.data.drafts[ctx.draft.draftKey];

test("agent path: fresh, draft-scoped World IdP confirm posts the exact draft as author type agent", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  assert.deepEqual(ctx.idp.lastAuthorize!.acrValues, ["https://world.org/oidc/acr/orb"]);

  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(outcome.ok, true);
  assert.equal(draftOf(ctx).status, "posted");
  assert.equal(ctx.host.comments.length, 1);
  assert.equal(ctx.host.comments[0].authorType, "agent");
  assert.equal(ctx.host.comments[0].text, "Phase in over three years, not five.");
  assert.match(ctx.host.comments[0].proofRef, /^agentpass:[0-9a-f]{64}$/);
  assert.deepEqual(ctx.deps.store.data.members[ctx.member.memberRef].idp, { iss: "https://auth.world.org", sub: "world-sub-1" });
});

test("agent path: drafts never post on their own", async () => {
  const ctx = await withDraft();
  assert.equal(draftOf(ctx).status, "pending");
  assert.equal(ctx.host.comments.length, 0);
});

test("agent path DENIED: human cancels at World ID → draft discarded, nothing posts", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ error: "access_denied", state }), ctx.member.memberRef);
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.reason, "cancelled");
  assert.equal(draftOf(ctx).status, "discarded");
  assert.equal(ctx.host.comments.length, 0);
});

test("agent path DENIED: confirm expires before the human finishes", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  ctx.advance(121);
  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!outcome.ok && outcome.reason, "confirm_expired");
  assert.equal(ctx.host.comments.length, 0);
});

test("agent path DENIED: abandoned confirm expires with no callback at all", async () => {
  const ctx = await withDraft();
  await started(ctx);
  ctx.advance(121);
  const [draft] = listDrafts(ctx.deps, ctx.member.memberRef);
  assert.equal(draft.status, "discarded");
  assert.equal(draft.discardReason, "confirm_expired");
});

test("agent path DENIED: agent swaps the draft text after the confirm was issued", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  editDraft(ctx.deps, ctx.member.memberRef, ctx.draft.draftKey, "Never regulate trucks.", "agent");

  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!outcome.ok && outcome.reason, "draft_changed");
  assert.equal(draftOf(ctx).status, "discarded");
  assert.equal(ctx.host.comments.length, 0, "an old approval can't carry a different draft");
});

test("agent path DENIED: callback replay can't post twice", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  const replay = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!replay.ok && replay.reason, "confirm_replayed");
  assert.equal(ctx.host.comments.length, 1);
});

test("agent path DENIED: stale World session (auth_time before the attempt) is not fresh", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  const base = ctx.idp.claims;
  ctx.idp.claims = (nonce) => ({ ...base(nonce), auth_time: ctx.now() - 3600 });
  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!outcome.ok && outcome.reason, "not_fresh");
});

test("agent path DENIED: assurance below the required acr", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  const base = ctx.idp.claims;
  ctx.idp.claims = (nonce) => ({ ...base(nonce), acr: "https://world.org/oidc/acr/passkey" });
  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!outcome.ok && outcome.reason, "acr_insufficient");
});

test("agent path DENIED: a different World account than the one linked to the member", async () => {
  const ctx = await withDraft();
  await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state: await started(ctx) }), ctx.member.memberRef);

  const second = await createDraft(ctx.deps, ctx.member.memberRef, {
    docketKey: "truck-emissions-rule",
    topic: "enforcement",
    text: "More inspectors.",
  });
  await startAgentConfirm(ctx.deps, ctx.member.memberRef, second.draftKey);
  assert.equal(ctx.idp.lastAuthorize!.requiredSub, "world-sub-1", "World is asked for the linked account");
  const base = ctx.idp.claims;
  ctx.idp.claims = (nonce) => ({ ...base(nonce), sub: "someone-else" });
  const outcome = await completeAgentConfirm(
    ctx.deps,
    callbackUrl({ code: "c", state: ctx.idp.lastAuthorize!.state }),
    ctx.member.memberRef,
  );
  assert.equal(!outcome.ok && outcome.reason, "identity_mismatch");
});

test("agent path DENIED: member can't edit mid-confirm, and a second comment on the same topic is refused", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  assert.throws(
    () => editDraft(ctx.deps, ctx.member.memberRef, ctx.draft.draftKey, "edit", "member"),
    (e: unknown) => e instanceof GateError && e.reason === "confirm_in_progress",
  );
  await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);

  const dup = await createDraft(ctx.deps, ctx.member.memberRef, {
    docketKey: "truck-emissions-rule",
    topic: "phase-in-timeline",
    text: "Again.",
  });
  await assert.rejects(
    startAgentConfirm(ctx.deps, ctx.member.memberRef, dup.draftKey),
    (e: unknown) => e instanceof GateError && e.reason === "already_commented",
  );
});

test("agent path: the approved position posts with the draft", async () => {
  const ctx = makeDeps();
  const req = await createWorldRequest(ctx.deps, { purpose: "join", handle: "maya" }, null);
  const member = await submitJoin(ctx.deps, fakeIdkitResult(req, { nullifier: "111" }));
  const draft = await createDraft(ctx.deps, member.memberRef, {
    docketKey: "truck-emissions-rule",
    topic: "enforcement",
    text: "Fines should scale with fleet size.",
    sentiment: "support",
  });
  assert.equal(draft.sentiment, "support");
  await startAgentConfirm(ctx.deps, member.memberRef, draft.draftKey);
  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state: ctx.idp.lastAuthorize!.state }), member.memberRef);
  assert.equal(outcome.ok, true);
  assert.equal(ctx.host.comments[0].sentiment, "support");
});

test("agent path DENIED: agent flips only the position after the confirm was issued", async () => {
  const ctx = await withDraft();
  const state = await started(ctx);
  editDraft(ctx.deps, ctx.member.memberRef, ctx.draft.draftKey, ctx.draft.text, "agent", "oppose");

  const outcome = await completeAgentConfirm(ctx.deps, callbackUrl({ code: "c", state }), ctx.member.memberRef);
  assert.equal(!outcome.ok && outcome.reason, "draft_changed");
  assert.equal(ctx.host.comments.length, 0, "an approval for one position can't post the other");
});
