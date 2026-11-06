import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAgentModels } from "../src/world/agent-models";
import type { AgentModel } from "../src/world/agent-interview";

const ok = (name: string): AgentModel => async () => ({ content: [{ type: "text", text: `from ${name}` }], stop_reason: "end_turn" }) as never;
const failing = (name: string): AgentModel => async () => {
  throw new Error(`${name} is out of quota`);
};

test("no configured provider leaves the agent off", () => {
  assert.equal(composeAgentModels(undefined, undefined), undefined);
});

test("one configured provider is used directly, with no wrapping", () => {
  const solo = ok("only");
  assert.equal(composeAgentModels(undefined, solo, undefined), solo);
});

test("falls through to the next provider when the first fails, exactly the bug that stranded a quota-exhausted key", async () => {
  const model = composeAgentModels(failing("gemini"), ok("groq"))!;
  const response = await model({ system: "s", messages: [], tools: [] });
  assert.equal((response.content[0] as { text: string }).text, "from groq");
});

test("tries every configured provider in order before giving up", async () => {
  const tried: string[] = [];
  const track = (name: string, fn: AgentModel): AgentModel => async (request) => {
    tried.push(name);
    return fn(request);
  };
  const model = composeAgentModels(track("a", failing("a")), track("b", failing("b")), track("c", ok("c")))!;
  await model({ system: "s", messages: [], tools: [] });
  assert.deepEqual(tried, ["a", "b", "c"]);
});

test("rethrows the last provider's failure only when every configured provider fails", async () => {
  const model = composeAgentModels(failing("groq"), failing("gemini"))!;
  await assert.rejects(model({ system: "s", messages: [], tools: [] }), /gemini is out of quota/);
});

test("a working first provider is never asked to fall back", async () => {
  let secondCalled = false;
  const second: AgentModel = async () => {
    secondCalled = true;
    return { content: [], stop_reason: "end_turn" } as never;
  };
  const model = composeAgentModels(ok("first"), second)!;
  await model({ system: "s", messages: [], tools: [] });
  assert.equal(secondCalled, false);
});
