import type { DraftDto } from "../shared";
import type { Deps } from "../deps";
import { GateError } from "../errors";
import { draftHash, randomToken, sha256Hex } from "../crypto";
import type { DraftRecord } from "../store";
import { MAX_COMMENT_CHARS, parseSentiment } from "./idkit";

/**
 * Agent drafts. A member's own agent (holding a member-issued token) can read a docket
 * and park a draft here. Nothing an agent does can post: only a completed Agent Pass
 * step-up for the draft's exact hash does (see agent-pass.ts).
 */

export function createAgentToken(deps: Deps, memberRef: string, label: string): string {
  const token = `cda_${randomToken(32)}`;
  deps.store.mutate((d) => {
    d.agentTokens[sha256Hex(token)] = { memberRef, label: label.slice(0, 64) || "agent", createdAt: deps.now() };
  });
  return token;
}

export function resolveAgentToken(deps: Deps, authorization: string | undefined): string {
  const token = authorization?.match(/^Bearer\s+(cda_[\w-]+)$/)?.[1];
  const rec = token ? deps.store.data.agentTokens[sha256Hex(token)] : undefined;
  if (!rec) throw new GateError("agent_unauthorized", "Missing or unknown agent token.", 401);
  return rec.memberRef;
}

function cleanText(text: unknown): string {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.length > MAX_COMMENT_CHARS) {
    throw new GateError("invalid_text", `Draft must be 1–${MAX_COMMENT_CHARS} characters.`);
  }
  return t;
}

export async function createDraft(
  deps: Deps,
  memberRef: string,
  input: { docketKey: string; topic: string; text: unknown; sentiment?: unknown },
): Promise<DraftRecord> {
  const docket = await deps.host.getDocket(input.docketKey);
  if (!docket) throw new GateError("unknown_docket", "No such docket.", 404);
  if (docket.status !== "open" || docket.deadline <= deps.now()) throw new GateError("docket_closed", "Docket is closed.");
  if (!docket.topics.includes(input.topic)) throw new GateError("unknown_topic", "That topic is not on this docket.");
  const text = cleanText(input.text);
  const sentiment = parseSentiment(input.sentiment);
  const now = deps.now();
  const draft: DraftRecord = {
    draftKey: `draft_${randomToken(12)}`,
    memberRef,
    docketKey: docket.key,
    topic: input.topic,
    text,
    sentiment,
    draftHash: draftHash(docket.key, input.topic, text, sentiment),
    revision: 1,
    status: "pending",
    createdAt: now,
    expiresAt: Math.min(now + deps.config.AGENT_DRAFT_TTL_SECONDS, docket.deadline),
  };
  deps.store.mutate((d) => {
    d.drafts[draft.draftKey] = draft;
  });
  return draft;
}

export function getOwnDraft(deps: Deps, memberRef: string, draftKey: string): DraftRecord {
  sweepDrafts(deps);
  const draft = deps.store.data.drafts[draftKey];
  if (!draft || draft.memberRef !== memberRef) throw new GateError("unknown_draft", "No such draft.", 404);
  return draft;
}

/**
 * Agents may rewrite a draft at any time before it posts — including while a confirm is
 * in flight. That's deliberate: the confirm is bound to the hash at start, so a rewrite
 * makes it fail and the draft is discarded (the "swap the text under an old approval" attack).
 * Members may only edit while nothing is pending.
 */
export function editDraft(
  deps: Deps,
  memberRef: string,
  draftKey: string,
  text: unknown,
  by: "agent" | "member",
  sentiment?: unknown,
) {
  const draft = getOwnDraft(deps, memberRef, draftKey);
  if (draft.status === "posted" || draft.status === "discarded") {
    throw new GateError(`draft_${draft.status}`, `Draft is already ${draft.status}.`, 409);
  }
  if (draft.status === "confirming" && by === "member") {
    throw new GateError("confirm_in_progress", "Finish or cancel the World ID confirm before editing.", 409);
  }
  const clean = cleanText(text);
  const position = sentiment === undefined ? draft.sentiment : parseSentiment(sentiment);
  return deps.store.mutate((d) => {
    const rec = d.drafts[draftKey];
    rec.text = clean;
    rec.sentiment = position;
    rec.draftHash = draftHash(rec.docketKey, rec.topic, clean, position);
    rec.revision += 1;
    return rec;
  });
}

export function discardDraft(deps: Deps, draftKey: string, reason: string) {
  deps.store.mutate((d) => {
    const rec = d.drafts[draftKey];
    if (!rec || rec.status === "posted" || rec.status === "discarded") return;
    rec.status = "discarded";
    rec.discardReason = reason;
    rec.confirmState = undefined;
  });
}

/** Lazily expires drafts and abandoned confirms. Expiry never needs a callback to fire. */
export function sweepDrafts(deps: Deps) {
  const now = deps.now();
  for (const draft of Object.values(deps.store.data.drafts)) {
    if (draft.status === "pending" && now > draft.expiresAt) discardDraft(deps, draft.draftKey, "draft_expired");
    if (draft.status === "confirming" && draft.confirmExpiresAt && now > draft.confirmExpiresAt) {
      discardDraft(deps, draft.draftKey, "confirm_expired");
    }
  }
}

export function listDrafts(deps: Deps, memberRef: string, docketKey?: string): DraftRecord[] {
  sweepDrafts(deps);
  return Object.values(deps.store.data.drafts)
    .filter((d) => d.memberRef === memberRef && (!docketKey || d.docketKey === docketKey))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function toDraftDto(d: DraftRecord): DraftDto {
  return {
    draftKey: d.draftKey,
    docketKey: d.docketKey,
    topic: d.topic,
    text: d.text,
    sentiment: d.sentiment,
    draftHash: d.draftHash,
    revision: d.revision,
    status: d.status,
    discardReason: d.discardReason,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    confirmExpiresAt: d.status === "confirming" ? d.confirmExpiresAt : undefined,
    posted: d.posted && { commentRef: d.posted.commentRef, ensName: d.posted.ensName },
  };
}
