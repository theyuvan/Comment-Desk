import { GateError } from "../errors";
import type { AgentModel } from "./agent-interview";

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; gemini_part?: unknown };
type Part = { text?: string; thought?: boolean; functionCall?: { name: string; args?: unknown }; functionResponse?: unknown; thoughtSignature?: string };

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash";
const REFUSALS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

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

/** The interview speaks the Anthropic message format, and this converts it for Gemini. */
export function toGeminiContents(messages: { role: string; content: unknown }[]) {
  const toolNames = new Map<string, string>();
  return messages.map((message) => {
    const parts = blocksOf(message.content).map((block): unknown => {
      if (block.type === "text") return { text: block.text };
      if (block.type === "tool_use") {
        toolNames.set(block.id!, block.name!);
        // The original part carries the thought signature Gemini expects back.
        return block.gemini_part ?? { functionCall: { name: block.name, args: block.input } };
      }
      const result = parseResult(block.content);
      return {
        functionResponse: {
          name: toolNames.get(block.tool_use_id!) ?? "save_draft",
          response: block.is_error ? { error: result } : { result },
        },
      };
    });
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });
}

/** Gemini's schema rejects JSON Schema keywords it doesn't know. */
export function toGeminiTools(tools: { name: string; description?: string; input_schema: unknown }[]) {
  return [
    {
      functionDeclarations: tools.map(({ name, description, input_schema }) => {
        const { additionalProperties: _unused, ...parameters } = input_schema as Record<string, unknown>;
        return { name, description, parameters };
      }),
    },
  ];
}

/** Converts a reply back, so the interview loop runs unchanged. */
export function fromGeminiResponse(body: {
  candidates?: { finishReason?: string; content?: { parts?: Part[] } }[];
  promptFeedback?: { blockReason?: string };
}) {
  const candidate = body.candidates?.[0];
  if (body.promptFeedback?.blockReason || (candidate?.finishReason && REFUSALS.has(candidate.finishReason))) {
    return { content: [], stop_reason: "refusal" };
  }
  let calls = 0;
  const content = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought || part.functionCall)
    .flatMap((part): Block[] => {
      if (part.functionCall) {
        return [{ type: "tool_use", id: `gemini_${++calls}`, name: part.functionCall.name, input: part.functionCall.args ?? {}, gemini_part: part }];
      }
      return part.text ? [{ type: "text", text: part.text }] : [];
    });
  return { content, stop_reason: calls > 0 ? "tool_use" : "end_turn" };
}

/** Gemini for the drafting agent. Off without GEMINI_API_KEY. */
export function createGeminiAgentModel(model: string, apiKey = process.env.GEMINI_API_KEY, send: typeof fetch = fetch): AgentModel | undefined {
  if (!apiKey) return undefined;
  const name = model.startsWith("claude") ? DEFAULT_MODEL : model;

  return async ({ system, messages, tools }) => {
    const request = {
      systemInstruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages as never),
      tools: toGeminiTools(tools as never),
      generationConfig: { maxOutputTokens: 8000 },
    };
    for (let attempt = 0; ; attempt++) {
      const response = await send(`${API}/${encodeURIComponent(name)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => undefined);

      if (response?.ok) return fromGeminiResponse(await response.json()) as never;
      // Busy or rate limited: worth a couple of quick retries while the member waits.
      if (attempt < 2 && (!response || response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      // The status alone: a provider error could echo the request.
      console.error(`[agent] Gemini answered ${response?.status ?? "with no response"}`);
      throw new GateError("agent_unavailable", "The drafting agent is busy. Try again in a moment.", 503);
    }
  };
}
