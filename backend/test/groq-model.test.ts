import { test } from "node:test";
import assert from "node:assert/strict";
import { GateError } from "../src/errors";
import { createGroqAgentModel, fromGroqResponse, toGroqMessages, toGroqTools } from "../src/world/groq-model";

const respond = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

test("groq: converts a tool round trip to OpenAI-shaped messages", () => {
  const messages = toGroqMessages([
    { role: "user", content: "Hello" },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "save_draft", input: { topic: "cost" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"saved":true}' }] },
  ]);
  assert.deepEqual(messages[0], { role: "user", content: "Hello" });
  assert.deepEqual(messages[1], {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call_1", type: "function", function: { name: "save_draft", arguments: '{"topic":"cost"}' } }],
  });
  assert.deepEqual(messages[2], { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ result: { saved: true } }) });
});

test("groq: reports a failed tool as an error, not a result", () => {
  const messages = toGroqMessages([
    { role: "assistant", content: [{ type: "tool_use", id: "t", name: "save_draft", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "Bad topic" }] },
  ]);
  assert.deepEqual(messages[1], { role: "tool", tool_call_id: "t", content: JSON.stringify({ error: "Bad topic" }) });
});

test("groq: keeps assistant text alongside a tool call, and omits tool_calls when there are none", () => {
  const withText = toGroqMessages([{ role: "assistant", content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "t", name: "save_draft", input: {} }] }]);
  assert.equal(withText[0]?.content, "On it.");
  assert.ok(withText[0]?.tool_calls);

  const textOnly = toGroqMessages([{ role: "assistant", content: [{ type: "text", text: "Which topic?" }] }]);
  assert.equal(textOnly[0]?.content, "Which topic?");
  assert.equal("tool_calls" in textOnly[0]!, false);
});

test("groq: offers OpenAI-shaped function tools, parameters passed through as-is", () => {
  const tools = toGroqTools([{ name: "save_draft", description: "Park it", input_schema: { type: "object", properties: {}, additionalProperties: false } }]);
  assert.deepEqual(tools, [{ type: "function", function: { name: "save_draft", description: "Park it", parameters: { type: "object", properties: {}, additionalProperties: false } } }]);
});

test("groq: a tool call stops for the tool, and plain text ends the turn", () => {
  const call = fromGroqResponse({
    choices: [{ message: { tool_calls: [{ id: "call_1", function: { name: "save_draft", arguments: '{"topic":"cost"}' } }] }, finish_reason: "tool_calls" }],
  });
  assert.equal(call.stop_reason, "tool_use");
  assert.deepEqual(call.content, [{ type: "tool_use", id: "call_1", name: "save_draft", input: { topic: "cost" } }]);

  const text = fromGroqResponse({ choices: [{ message: { content: "Which topic?" }, finish_reason: "stop" }] });
  assert.equal(text.stop_reason, "end_turn");
  assert.deepEqual(text.content, [{ type: "text", text: "Which topic?" }]);
});

test("groq: malformed tool arguments don't crash the turn", () => {
  const call = fromGroqResponse({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: "save_draft", arguments: "not json" } }] }, finish_reason: "tool_calls" }] });
  assert.deepEqual((call.content[0] as { input: unknown }).input, {});
});

test("groq: a content filter becomes a refusal", () => {
  assert.equal(fromGroqResponse({ choices: [{ finish_reason: "content_filter" }] }).stop_reason, "refusal");
});

test("groq: stays off without a key, and falls back to its own default for another provider's model name", async () => {
  assert.equal(createGroqAgentModel("openai/gpt-oss-120b", ""), undefined);
  let sentModel = "";
  const model = createGroqAgentModel("claude-opus-5-5", "key", (async (_url: string, init: RequestInit) => {
    sentModel = (JSON.parse(init.body as string) as { model: string }).model;
    return respond(200, { choices: [{ message: { content: "Hi" }, finish_reason: "stop" }] });
  }) as never)!;
  await model({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] });
  assert.equal(sentModel, "openai/gpt-oss-120b");
});

test("groq: retries when busy, and failures never expose the provider's text or key", async () => {
  let calls = 0;
  const retried = createGroqAgentModel("openai/gpt-oss-120b", "key", (async () => {
    calls++;
    return calls === 1 ? respond(503) : respond(200, { choices: [{ message: { content: "Ok" }, finish_reason: "stop" }] });
  }) as never)!;
  await retried({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] });
  assert.equal(calls, 2);

  const failing = createGroqAgentModel("openai/gpt-oss-120b", "secret-key", (async () => respond(401, { error: { message: "invalid api key secret-key" } })) as never)!;
  await assert.rejects(
    failing({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] }),
    (error: unknown) => error instanceof GateError && error.reason === "agent_unavailable" && !error.message.includes("secret-key"),
  );
});
