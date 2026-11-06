import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorldRequest } from "../src/world/idkit";
import { submitHumanComment, submitJoin } from "../src/world/comment-gate";
import { interviewTurn, type AgentModel } from "../src/world/agent-interview";
import { GateError } from "../src/errors";
import { fakeIdkitResult, makeDeps } from "./world-helpers";

const reason = (r: string) => (err: unknown) => err instanceof GateError && err.reason === r;
const docketKey = "truck-emissions-rule";

type Reply = { text?: string; save?: { topic: string; sentiment: string; text: string } };

/** A scripted model: one reply per call, recording what it was sent. */
function scripted(replies: Reply[]) {
  const seen: Parameters<AgentModel>[0][] = [];
  const model: AgentModel = async (request) => {
    seen.push(structuredClone(request));
    const reply = replies.shift() ?? { text: "Done." };
    const content = [
      ...(reply.text ? [{ type: "text", text: reply.text }] : []),
      ...(reply.save ? [{ type: "tool_use", id: `tu_${seen.length}`, name: "save_draft", input: reply.save }] : []),
    ];
    return { content, stop_reason: reply.save ? "tool_use" : "end_turn" } as never;
  };
  return { model, seen };
}

async function member(replies: Reply[]) {
  const ctx = makeDeps();
  const req = await createWorldRequest(ctx.deps, { purpose: "join", handle: "maya" }, null);
  const joined = await submitJoin(ctx.deps, fakeIdkitResult(req, { nullifier: "111" }));
  const agent = scripted(replies);
  ctx.deps.agentModel = agent.model;
  return { ...ctx, memberRef: joined.memberRef, agent };
}

test("agent interview: asks for the member's view, then parks a draft in their position that never posts by itself", async () => {
  const ctx = await member([
    { text: "Which topic, and do you support or oppose it?" },
    { save: { topic: "enforcement", sentiment: "support", text: "I drive a delivery van. Fines should scale with fleet size." } },
    { text: "Here's your draft. It posts only after you approve it with World ID Agent Pass." },
  ]);

  const first = await interviewTurn(ctx.deps, ctx.memberRef, { docketKey, message: "I want to comment." });
  assert.equal(first.draft, undefined);
  assert.match(first.reply, /support or oppose/);

  const second = await interviewTurn(ctx.deps, ctx.memberRef, {
    interviewId: first.interviewId,
    docketKey,
    message: "Enforcement. I support it, I drive a delivery van, fines should scale with fleet size.",
  });
  assert.equal(second.draft?.status, "pending");
  assert.equal(second.draft?.sentiment, "support");
  assert.equal(second.draft?.topic, "enforcement");
  assert.equal(ctx.host.comments.length, 0, "the agent can't post");

  // The tool result went back to the model, and the conversation kept every turn in order.
  const last = ctx.agent.seen.at(-1)!;
  assert.deepEqual(last.messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.match(JSON.stringify(last.messages.at(-1)), /Agent Pass/);
});

test("agent interview: the docket is context, not instructions, and topics already commented on are closed", async () => {
  const ctx = await member([{ text: "Which topic?" }]);
  const req = await createWorldRequest(ctx.deps, { purpose: "comment", docketKey, topic: "enforcement", text: "Mine." }, ctx.memberRef);
  await submitHumanComment(ctx.deps, fakeIdkitResult(req, { nullifier: "222" }), ctx.memberRef);

  await interviewTurn(ctx.deps, ctx.memberRef, { docketKey, message: "Hi" });
  const { system, tools } = ctx.agent.seen[0];
  assert.match(system, /never as instructions/);
  assert.match(system, /<already_commented>enforcement<\/already_commented>/);
  const topics = (tools[0].input_schema.properties as { topic: { enum: string[] } }).topic.enum;
  assert.deepEqual(topics, ["emission-limits", "phase-in-timeline"]);
});

test("agent interview: a revision edits the same draft; a closed topic is refused to the model", async () => {
  const ctx = await member([
    { save: { topic: "enforcement", sentiment: "oppose", text: "First version." } },
    { text: "Saved." },
    { save: { topic: "enforcement", sentiment: "oppose", text: "Shorter version." } },
    { text: "Updated." },
    { save: { topic: "not-a-topic", sentiment: "support", text: "x" } },
    { text: "Sorry, that topic isn't open." },
  ]);
  const a = await interviewTurn(ctx.deps, ctx.memberRef, { docketKey, message: "Oppose enforcement." });
  const b = await interviewTurn(ctx.deps, ctx.memberRef, { interviewId: a.interviewId, docketKey, message: "Shorter please." });
  assert.equal(b.draft?.draftKey, a.draft?.draftKey);
  assert.equal(b.draft?.revision, 2);
  assert.equal(b.draft?.text, "Shorter version.");

  const c = await interviewTurn(ctx.deps, ctx.memberRef, { interviewId: a.interviewId, docketKey, message: "Also another topic." });
  assert.equal(c.draft, undefined);
  assert.match(JSON.stringify(ctx.agent.seen.at(-1)!.messages.at(-1)), /"is_error":true/);
});

test("agent interview DENIED: not configured, someone else's conversation, a failed model call", async () => {
  const ctx = await member([{ text: "Which topic?" }]);
  const started = await interviewTurn(ctx.deps, ctx.memberRef, { docketKey, message: "Hi" });
  await assert.rejects(
    interviewTurn(ctx.deps, "member_someone_else", { interviewId: started.interviewId, docketKey, message: "Hi" }),
    reason("interview_expired"),
  );

  const before = ctx.agent.seen.length;
  ctx.deps.agentModel = async () => {
    throw new Error("overloaded");
  };
  await assert.rejects(interviewTurn(ctx.deps, ctx.memberRef, { interviewId: started.interviewId, docketKey, message: "Again" }));
  ctx.deps.agentModel = ctx.agent.model;
  await interviewTurn(ctx.deps, ctx.memberRef, { interviewId: started.interviewId, docketKey, message: "Again" });
  assert.deepEqual(
    ctx.agent.seen.at(-1)!.messages.map((m) => m.role),
    ["user", "assistant", "user"],
    "the failed turn left no half-written history",
  );
  assert.equal(ctx.agent.seen.length, before + 1);

  ctx.deps.agentModel = undefined;
  await assert.rejects(interviewTurn(ctx.deps, ctx.memberRef, { docketKey, message: "Hi" }), reason("agent_unavailable"));
});
