import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { ArkivStore } from "./arkiv/store.ts";
import { AppError, opId, textHash } from "./core.ts";
import type { Desk } from "./desk.ts";
import type { DeskWorldHost } from "./host/desk-host.ts";

/**
 * A stand-in for the World backend, on the same paths and with the same response
 * shapes, so the frontend runs unchanged before and after the real gates land.
 * It checks no proofs. It runs only with WORLD_GATE=dev, is refused in production,
 * and every record it creates has a "dev:" proof reference.
 */
const COOKIE = "cd_dev_member";

type Pending =
  | { purpose: "join"; handle: string; wallet?: string }
  | { purpose: "comment"; docketKey: string; topic: string; text: string; sentiment?: string };

const requestInput = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("join"), handle: z.string(), wallet: z.string().optional() }),
  z.object({
    purpose: z.literal("comment"),
    docketKey: z.string(),
    topic: z.string(),
    text: z.string(),
    sentiment: z.string().optional(),
  }),
]);
const agentInput = z.object({
  docketKey: z.string(),
  topic: z.string(),
  text: z.string(),
  sentiment: z.string().optional(),
  changedAfterApproval: z.boolean().optional(),
});
const signInInput = z.object({ issuedAt: z.coerce.bigint().positive(), signature: z.string() });

export function devWorldRoutes(deps: { desk: Desk; store: ArkivStore; host: DeskWorldHost }) {
  const { desk, store, host } = deps;
  const app = new Hono();
  const pending = new Map<string, Pending>();

  const memberOf = async (context: Context) => {
    const ref = getCookie(context, COOKIE);
    return ref && /^0x[0-9a-f]{64}$/i.test(ref) ? ((await store.getMember(ref as `0x${string}`)) ?? null) : null;
  };
  const requireMember = async (context: Context) => {
    const member = await memberOf(context);
    if (!member) throw new AppError(401, "not_a_member", "Join Comment Desk first.");
    return member;
  };
  const issue = (context: Context, memberRef: string) =>
    setCookie(context, COOKIE, memberRef, { httpOnly: true, sameSite: "Lax", path: "/" });

  // The World branch reports failures as { error, reason }, so the stand-in does too.
  app.onError((error, context) => {
    if (error instanceof AppError) return context.json({ error: error.message, reason: error.code }, error.status);
    if (error instanceof z.ZodError) return context.json({ error: "Invalid request body.", reason: "invalid_input" }, 400);
    console.error(`[world-dev] ${(error as Error).name}`);
    return context.json({ error: "Internal error.", reason: "internal" }, 500);
  });

  app.get("/api/session", async (context) => {
    const member = await memberOf(context);
    return context.json(member ? { memberRef: member.key, ensName: member.ensName, worldLinked: false } : null);
  });

  app.post("/api/session/logout", (context) => {
    deleteCookie(context, COOKIE, { path: "/" });
    return context.json({ ok: true });
  });

  app.post("/api/session/wallet", async (context) => {
    const body = signInInput.parse(await context.req.json());
    const member = await desk.signIn({ issuedAt: body.issuedAt, signature: body.signature as `0x${string}` });
    issue(context, member.memberRef);
    return context.json(member);
  });

  app.post("/api/world/requests", async (context) => {
    const input = requestInput.parse(await context.req.json());
    if (input.purpose === "comment") {
      await requireMember(context);
      await desk.assertCanComment(input.docketKey, input.topic);
    }
    const nonce = crypto.randomUUID();
    pending.set(nonce, input);
    return context.json({
      app_id: "app_dev_stand_in",
      action: input.purpose === "join" ? "commentdesk-join" : `comment:${input.docketKey}:${input.topic}`,
      action_description: input.purpose === "join" ? "Join Comment Desk" : "Post this comment",
      signal: input.purpose === "join" ? (input.wallet ?? "") : textHash(input.text),
      credential: "selfie",
      environment: "staging",
      allow_legacy_proofs: false,
      require_user_presence: false,
      rp_context: { rp_id: "rp_dev", nonce, created_at: 0, expires_at: 0, signature: "dev" },
    });
  });

  const claim = (nonce: unknown, purpose: Pending["purpose"]) => {
    const request = typeof nonce === "string" ? pending.get(nonce) : undefined;
    if (!request || request.purpose !== purpose) throw new AppError(400, "request_expired", "That verification expired. Start again.");
    pending.delete(nonce as string);
    return request;
  };

  app.post("/api/world/verify/join", async (context) => {
    const { result } = (await context.req.json()) as { result?: { nonce?: string; subject?: string } };
    const request = claim(result?.nonce, "join") as Extract<Pending, { purpose: "join" }>;
    const nullifier = `dev:${textHash(`nullifier:${result?.subject ?? request.wallet}`).slice(2, 66)}`;

    const existing = await store.findMemberByNullifier(nullifier);
    if (existing) {
      issue(context, existing.key);
      return context.json({ memberRef: existing.key, ensName: existing.ensName, returning: true });
    }
    const created = await host.onMemberVerified({ proofRef: `dev:${nullifier.slice(4, 44)}`, nullifier }, request);
    issue(context, created.memberRef);
    return context.json({ ...created, returning: false });
  });

  app.post("/api/world/verify/comment", async (context) => {
    const member = await requireMember(context);
    const { result } = (await context.req.json()) as { result?: { nonce?: string } };
    const request = claim(result?.nonce, "comment") as Extract<Pending, { purpose: "comment" }>;
    const proofRef = `dev:${opId("human", result?.nonce ?? "").slice(2, 42)}`;
    return context.json(
      await host.onCommentVerified({ proofRef }, { ...request, memberRef: member.key, authorType: "human" }),
    );
  });

  /** Replaced on the World branch by parked drafts and the Agent Pass redirect. */
  app.post("/api/dev/agent-confirm", async (context) => {
    const member = await requireMember(context);
    const input = agentInput.parse(await context.req.json());
    if (input.changedAfterApproval) {
      throw new AppError(403, "draft_changed", "The draft changed after approval was requested.");
    }
    await desk.assertCanComment(input.docketKey, input.topic);
    const proofRef = `dev:${opId("agent", member.key, input.text, Date.now()).slice(2, 42)}`;
    return context.json(
      await host.onCommentVerified(
        { proofRef },
        { docketKey: input.docketKey, topic: input.topic, text: input.text, sentiment: input.sentiment, memberRef: member.key, authorType: "agent" },
      ),
    );
  });

  return app;
}
