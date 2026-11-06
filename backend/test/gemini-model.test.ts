import { test } from "node:test";
import assert from "node:assert/strict";
import { GateError } from "../src/errors";
import { createGeminiAgentModel, fromGeminiResponse, toGeminiContents, toGeminiTools } from "../src/world/gemini-model";

const respond = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

test("gemini: converts a tool round trip and keeps the thought signature", () => {
  const part = { functionCall: { name: "save_draft", args: { topic: "cost" } }, thoughtSignature: "sig" };
  const contents = toGeminiContents([
    { role: "user", content: "Hello" },
    { role: "assistant", content: [{ type: "tool_use", id: "gemini_1", name: "save_draft", input: {}, gemini_part: part }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "gemini_1", content: '{"saved":true}' }] },
  ]);
  assert.deepEqual(contents[0], { role: "user", parts: [{ text: "Hello" }] });
  assert.deepEqual(contents[1], { role: "model", parts: [part] });
  assert.deepEqual(contents[2]?.parts[0], { functionResponse: { name: "save_draft", response: { result: { saved: true } } } });
});

test("gemini: reports a failed tool as an error, not a result", () => {
  const contents = toGeminiContents([
    { role: "assistant", content: [{ type: "tool_use", id: "t", name: "save_draft", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "Bad topic" }] },
  ]);
  assert.deepEqual(contents[1]?.parts[0], { functionResponse: { name: "save_draft", response: { error: "Bad topic" } } });
});

test("gemini: offers exactly the tools it was given, without unsupported keywords", () => {
  const [tools] = toGeminiTools([{ name: "save_draft", description: "Park it", input_schema: { type: "object", properties: {}, additionalProperties: false } }]);
  assert.equal(tools?.functionDeclarations.length, 1);
  assert.equal(JSON.stringify(tools).includes("additionalProperties"), false);
});

test("gemini: a function call stops for the tool, and text ends the turn", () => {
  const call = fromGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "save_draft", args: { topic: "cost" } } }] } }] });
  assert.equal(call.stop_reason, "tool_use");
  assert.equal((call.content[0] as { input: { topic: string } }).input.topic, "cost");

  const text = fromGeminiResponse({ candidates: [{ content: { parts: [{ text: "Which topic?" }, { text: "hidden", thought: true }] } }] });
  assert.equal(text.stop_reason, "end_turn");
  assert.equal(text.content.length, 1);
});

test("gemini: a safety block becomes a refusal", () => {
  assert.equal(fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }).stop_reason, "refusal");
  assert.equal(fromGeminiResponse({ candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }).stop_reason, "refusal");
});

test("gemini: stays off without a key, and never sends a Claude model name", async () => {
  assert.equal(createGeminiAgentModel("gemini-3.5-flash", ""), undefined);
  let url = "";
  const model = createGeminiAgentModel("claude-opus-5-5", "key", (async (input: string) => {
    url = input;
    return respond(200, { candidates: [{ content: { parts: [{ text: "Hi" }] } }] });
  }) as never)!;
  await model({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] });
  assert.ok(url.includes("gemini-3.5-flash:generateContent"));
});

test("gemini: retries when busy, and failures never expose the provider's text", async () => {
  let calls = 0;
  const retried = createGeminiAgentModel("gemini-3.5-flash", "key", (async () => {
    calls++;
    return calls === 1 ? respond(503) : respond(200, { candidates: [{ content: { parts: [{ text: "Ok" }] } }] });
  }) as never)!;
  await retried({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] });
  assert.equal(calls, 2);

  const failing = createGeminiAgentModel("gemini-3.5-flash", "secret-key", (async () => respond(400, { error: { message: "bad secret-key" } })) as never)!;
  await assert.rejects(
    failing({ system: "s", messages: [{ role: "user", content: "Hi" }], tools: [] }),
    (error: unknown) => error instanceof GateError && error.reason === "agent_unavailable" && !error.message.includes("secret-key"),
  );
});
