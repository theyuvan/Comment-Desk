import { GateError } from "../errors";
import type { AgentModel } from "./agent-interview";

/**
 * Groq for the drafting agent: an OpenAI-compatible chat API, so this adapter speaks the
 * same Anthropic message format the interview loop uses, converted to and from OpenAI's shape.
 * Verified live against Groq's own catalog and a real tool-call round trip before wiring in,
 * since a wrong model name here fails exactly the way the Gemini quota did.
 */

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
type OpenAiMessage = {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const API = "https://api.groq.com/openai/v1/chat/completions";
/** openai/gpt-oss-120b: the largest general model Groq serves on this key, built for tool use. */
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const REFUSAL_FINISH_REASONS = new Set(["content_filter"]);

const blocksOf = (content: unknown): Block[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : (content as Block[]);

const parseResult = (content: unknown) => {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

/** The interview speaks the Anthropic message format, and this converts it for Groq's chat API. */
export function toGroqMessages(messages: { role: string; content: unknown }[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const message of messages) {
    const blocks = blocksOf(message.content);
    if (message.role === "assistant") {
      const text = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const calls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id!,
          type: "function" as const,
          function: { name: block.name!, arguments: JSON.stringify(block.input ?? {}) },
        }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn is either plain text, or one Groq "tool" message per tool_result block.
    for (const block of blocks) {
      if (block.type === "tool_result") {
        const result = parseResult(block.content);
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: JSON.stringify(block.is_error ? { error: result } : { result }) });
      } else if (block.type === "text") {
        out.push({ role: "user", content: block.text ?? "" });
      }
    }
  }
  return out;
}

/** OpenAI-shaped function tools. Groq accepts plain JSON Schema, additionalProperties included. */
export function toGroqTools(tools: { name: string; description?: string; input_schema: unknown }[]) {
  return tools.map(({ name, description, input_schema }) => ({
    type: "function" as const,
    function: { name, description, parameters: input_schema },
  }));
}

/** Converts a reply back, so the interview loop runs unchanged. */
export function fromGroqResponse(body: {
  choices?: {
    message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
    finish_reason?: string;
  }[];
}) {
  const choice = body.choices?.[0];
  if (choice?.finish_reason && REFUSAL_FINISH_REASONS.has(choice.finish_reason)) {
    return { content: [], stop_reason: "refusal" };
  }
  const calls = choice?.message?.tool_calls ?? [];
  const content: Block[] = [];
  if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
  for (const call of calls) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  return { content, stop_reason: calls.length > 0 ? "tool_use" : "end_turn" };
}

/** Groq for the drafting agent: fast open-weight inference, OpenAI-compatible tool calling. Off without GROQ_API_KEY. */
export function createGroqAgentModel(model: string, apiKey = process.env.GROQ_API_KEY, send: typeof fetch = fetch): AgentModel | undefined {
  if (!apiKey) return undefined;
  const name = model.startsWith("claude") || model.startsWith("gemini") ? DEFAULT_MODEL : model;

  return async ({ system, messages, tools }) => {
    const request = {
      model: name,
      messages: [{ role: "system", content: system }, ...toGroqMessages(messages as never)],
      tools: toGroqTools(tools as never),
      tool_choice: "auto",
      max_tokens: 8000,
    };
    for (let attempt = 0; ; attempt++) {
      const response = await send(API, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => undefined);

      if (response?.ok) return fromGroqResponse(await response.json()) as never;
      // Busy or rate limited: worth a couple of quick retries while the member waits.
      if (attempt < 2 && (!response || response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      // The status alone: a provider error could echo the request or the key.
      console.error(`[agent] Groq answered ${response?.status ?? "with no response"}`);
      throw new GateError("agent_unavailable", "The drafting agent is busy. Try again in a moment.", 503);
    }
  };
}
