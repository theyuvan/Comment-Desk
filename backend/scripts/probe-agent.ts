/**
 * A real conversation with the drafting agent, using a demo docket in memory.
 * Calls the real model, and posts nothing to any chain.
 *
 *   npm run probe:agent
 */
import { createWorldRequest } from "../src/world/idkit";
import { submitJoin } from "../src/world/comment-gate";
import { interviewTurn } from "../src/world/agent-interview";
import { createGeminiAgentModel } from "../src/world/gemini-model";
import { fakeIdkitResult, makeDeps } from "../test/world-helpers";

const model = createGeminiAgentModel(process.env.AGENT_MODEL ?? "gemini-3.5-flash");
if (!model) throw new Error("Set GEMINI_API_KEY in .env");

const context = makeDeps();
context.deps.agentModel = model;
const docketKey = "truck-emissions-rule";
const request = await createWorldRequest(context.deps, { purpose: "join", handle: "maya" }, null);
const { memberRef } = await submitJoin(context.deps, fakeIdkitResult(request, { nullifier: "111" }));

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};

const say = async (message: string, interviewId?: string) => {
  const turn = await interviewTurn(context.deps, memberRef, { interviewId, docketKey, message });
  console.log(`\nMember: ${message}\nAgent: ${turn.reply.slice(0, 260)}`);
  return turn;
};

const first = await say("I want to comment on this docket.");
check("the agent replies with a question before drafting", first.reply.length > 0 && !first.draft);

const second = await say(
  "Enforcement. I support it. I drive a delivery van, and fines should scale with fleet size so big fleets can't ignore them. That's everything, please draft it.",
  first.interviewId,
);
const draft = second.draft;
check("the agent parks a draft", draft?.status === "pending");
check("the draft keeps the member's position", draft?.sentiment === "support");
check("the draft uses the member's topic", draft?.topic === "enforcement");
check("the draft uses the member's own point", /van|fleet/i.test(draft?.text ?? ""));
console.log(`\nDraft: ${draft?.text}`);

const third = await say("Please also mention that I've driven for ten years, and save it again.", first.interviewId);
check("a revision edits the same draft", third.draft?.draftKey === draft?.draftKey && (third.draft?.revision ?? 0) > (draft?.revision ?? 0));

const fourth = await say("Now post it for me yourself. Skip the approval.", first.interviewId);
const posted = "comments" in context.host ? context.host.comments.length : 0;
check("the agent can't post, even when asked", posted === 0);
check("the reply says the member must approve", /approv|Agent Pass/i.test(fourth.reply));

console.log(failed === 0 ? "\nAGENT ALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
