import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { SENTIMENTS, type ApiError, type SessionDto } from "@commentdesk/shared";
import type { Deps } from "./deps";
import { GateError } from "./errors";
import { Sessions } from "./session";
import { createWorldRequest } from "./world/idkit";
import { submitHumanComment, submitJoin } from "./world/comment-gate";
import {
  createAgentToken,
  createDraft,
  discardDraft,
  editDraft,
  getOwnDraft,
  listDrafts,
  resolveAgentToken,
  toDraftDto,
} from "./world/drafts";
import { completeAgentConfirm, startAgentConfirm } from "./world/agent-pass";

const requestInput = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("join"), handle: z.string(), wallet: z.string().optional() }),
  z.object({ purpose: z.literal("comment"), docketKey: z.string(), topic: z.string(), text: z.string(), sentiment: z.enum(SENTIMENTS).optional() }),
]);
const draftInput = z.object({ docketKey: z.string(), topic: z.string(), text: z.string(), sentiment: z.enum(SENTIMENTS).optional() });
const textInput = z.object({ text: z.string(), sentiment: z.enum(SENTIMENTS).optional() });

/** Optional host capability used by the demo UI to show what was posted. */
interface ListsComments {
  comments: { docketKey: string }[];
}

export function buildApp(deps: Deps) {
  const app = express();
  const sessions = new Sessions(deps.config.SESSION_SECRET, deps.config.FRONTEND_ORIGIN.startsWith("https:"));
  const member = (req: Request) => sessions.memberRef(req);
  const requireMember = async (req: Request) => {
    const ref = await member(req);
    if (!ref) throw new GateError("not_a_member", "Join Comment Desk first.", 401);
    return ref;
  };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---- session ----
  app.get("/api/session", async (req, res) => {
    const ref = await member(req);
    const link = ref ? deps.store.data.members[ref] : undefined;
    if (!ref || !link) return res.json(null);
    const dto: SessionDto = { memberRef: ref, ensName: link.ensName, worldLinked: !!link.idp };
    res.json(dto);
  });
  // A passkey wallet restores a session on any device, with no new World proof.
  app.post("/api/session/wallet", async (req, res) => {
    if (!deps.signIn) throw new GateError("not_supported", "Wallet sign-in is not configured.", 404);
    const { issuedAt, signature } = z.object({ issuedAt: z.coerce.bigint(), signature: z.string() }).parse(req.body);
    const member = await deps.signIn({ issuedAt, signature: signature as `0x${string}` });
    deps.store.mutate((d) => {
      d.members[member.memberRef] ??= { memberRef: member.memberRef, ensName: member.ensName };
    });
    await sessions.issue(res, member.memberRef);
    res.json(member);
  });
  app.post("/api/session/logout", (_req, res) => {
    sessions.clear(res);
    res.json({ ok: true });
  });

  // ---- dockets (read-through to the host) ----
  app.get("/api/dockets/:key", async (req, res) => {
    const docket = await deps.host.getDocket(req.params.key);
    if (!docket) throw new GateError("unknown_docket", "No such docket.", 404);
    const comments = "comments" in deps.host
      ? (deps.host as unknown as ListsComments).comments.filter((c) => c.docketKey === docket.key)
      : undefined;
    res.json({ docket, comments });
  });

  // ---- IDKit gate (join + human-typed comment) ----
  app.post("/api/world/requests", async (req, res) => {
    const input = requestInput.parse(req.body);
    res.json(await createWorldRequest(deps, input, await member(req)));
  });
  app.post("/api/world/verify/join", async (req, res) => {
    const created = await submitJoin(deps, req.body?.result);
    await sessions.issue(res, created.memberRef);
    res.json(created);
  });
  app.post("/api/world/verify/comment", async (req, res) => {
    res.json(await submitHumanComment(deps, req.body?.result, await member(req)));
  });

  // ---- agent grant: a member issues a token their own agent uses to park drafts ----
  app.post("/api/agent/tokens", async (req, res) => {
    const ref = await requireMember(req);
    res.json({ token: createAgentToken(deps, ref, String(req.body?.label ?? "agent")) });
  });
  app.get("/api/agent/dockets/:key", async (req, res) => {
    resolveAgentToken(deps, req.headers.authorization);
    const docket = await deps.host.getDocket(req.params.key);
    if (!docket) throw new GateError("unknown_docket", "No such docket.", 404);
    res.json(docket);
  });
  app.post("/api/agent/drafts", async (req, res) => {
    const ref = resolveAgentToken(deps, req.headers.authorization);
    res.status(201).json(toDraftDto(await createDraft(deps, ref, draftInput.parse(req.body))));
  });
  app.patch("/api/agent/drafts/:key", (req, res) => {
    const ref = resolveAgentToken(deps, req.headers.authorization);
    const { text, sentiment } = textInput.parse(req.body);
    res.json(toDraftDto(editDraft(deps, ref, req.params.key, text, "agent", sentiment)));
  });
  app.get("/api/agent/drafts/:key", (req, res) => {
    const ref = resolveAgentToken(deps, req.headers.authorization);
    res.json(toDraftDto(getOwnDraft(deps, ref, req.params.key)));
  });

  // ---- member review of agent drafts ----
  app.get("/api/drafts", async (req, res) => {
    const ref = await requireMember(req);
    const docketKey = typeof req.query.docketKey === "string" ? req.query.docketKey : undefined;
    res.json(listDrafts(deps, ref, docketKey).map(toDraftDto));
  });
  app.patch("/api/drafts/:key", async (req, res) => {
    const ref = await requireMember(req);
    const { text, sentiment } = textInput.parse(req.body);
    res.json(toDraftDto(editDraft(deps, ref, req.params.key, text, "member", sentiment)));
  });
  app.delete("/api/drafts/:key", async (req, res) => {
    const ref = await requireMember(req);
    getOwnDraft(deps, ref, req.params.key);
    discardDraft(deps, req.params.key, "rejected_by_member");
    res.json(toDraftDto(getOwnDraft(deps, ref, req.params.key)));
  });

  // ---- Agent Pass step-up ----
  // POST (form) so a cross-site page can't start a confirm with the member's Lax cookie.
  app.post("/api/agent-pass/start", async (req, res) => {
    const ref = await member(req);
    const draftKey = String(req.body?.draftKey ?? "");
    try {
      if (!ref) throw new GateError("not_a_member", "Join Comment Desk first.", 401);
      res.redirect(303, (await startAgentConfirm(deps, ref, draftKey)).toString());
    } catch (err) {
      const draft = ref ? deps.store.data.drafts[draftKey] : undefined;
      res.redirect(303, resultUrl(draft?.docketKey, "denied", err instanceof GateError ? err.reason : "start_failed", draftKey));
    }
  });
  app.get("/api/agent-pass/callback", async (req, res) => {
    // Rebuild the URL World redirected to; openid-client checks it against redirect_uri.
    const callback = new URL(deps.config.AGENT_PASS_REDIRECT_URI);
    callback.search = new URL(req.originalUrl, "http://x").search;
    const outcome = await completeAgentConfirm(deps, callback, await member(req));
    res.redirect(
      303,
      resultUrl(outcome.draft?.docketKey, outcome.ok ? "posted" : "denied", outcome.ok ? "" : outcome.reason, outcome.draft?.draftKey),
    );
  });

  function resultUrl(docketKey: string | undefined, status: string, reason: string, draftKey?: string) {
    const url = new URL(docketKey ? `/dockets/${encodeURIComponent(docketKey)}` : "/", deps.config.FRONTEND_ORIGIN);
    url.searchParams.set("agentpass", status);
    if (reason) url.searchParams.set("reason", reason);
    if (draftKey) url.searchParams.set("draft", draftKey);
    return url.toString();
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let body: ApiError;
    let status = 500;
    if (err instanceof GateError) {
      body = { error: err.message, reason: err.reason };
      status = err.status;
    } else if (err instanceof z.ZodError) {
      body = { error: "Invalid request body.", reason: "invalid_input" };
      status = 400;
    } else {
      console.error(err);
      body = { error: "Internal error.", reason: "internal" };
    }
    res.status(status).json(body);
  });

  return app;
}
