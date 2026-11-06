import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { activity } from "./activity.ts";
import type { ArkivStore, CommentRecord, DocketRecord, DocketStatus, MemberRecord } from "./arkiv/store.ts";
import { DOMAIN, TYPES } from "./auth.ts";
import { AppError, ownerHash } from "./core.ts";
import { docketBodyHash, type Desk } from "./desk.ts";
import type { Publisher } from "./recount-client.ts";

const hex = z.custom<Hex>((value) => typeof value === "string" && isHex(value));
const bytes32 = z.custom<Hex>((value) => typeof value === "string" && isHex(value, { strict: true }) && value.length === 66);
const millis = z.coerce.bigint().positive();

const JoinPolicyBody = z.object({ handle: z.string(), issuedAt: millis, signature: hex });
const PolicyBody = z.object({ issuedAt: millis, signature: hex });
const OpenBody = z.object({
  label: z.string(),
  title: z.string(),
  question: z.string(),
  topics: z.array(z.string()),
  deadline: millis,
  credentialLevel: z.enum(["strict", "soft"]),
  issuedAt: millis,
  signature: hex,
});
const CloseBody = z.object({ ruling: z.string(), issuedAt: millis, signature: hex });
const ModerateBody = z.object({ reason: z.string(), issuedAt: millis, signature: hex });
const ArchiveBody = z.object({ swarmRef: z.string(), issuedAt: millis, signature: hex });

/** bigints become decimal strings. Raw wallets never appear: the records do not hold them. */
const stringify = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

function docketView({ opId: _op, ownerHash: _owner, ...docket }: DocketRecord, now = BigInt(Date.now())) {
  return { ...docket, phase: docket.status === "open" && now > docket.deadline ? "awaiting-ruling" : docket.status };
}

function commentView({ opId: _op, ownerHash: _owner, ...comment }: CommentRecord) {
  return comment;
}

function memberView(member: MemberRecord) {
  return { key: member.key, ensName: member.ensName, joinedAt: member.joinedAt, proofRef: member.proofRef };
}

/** Provider messages can contain the keyed RPC URL, so anything that looks like one is removed. */
function safeReason(error: unknown) {
  const { name, shortMessage, details } = error as Error & { shortMessage?: string; details?: string };
  const codes: string[] = [];
  for (let cause = (error as Error).cause as any; cause; cause = cause.cause) {
    if (typeof cause.code === "string") codes.push(cause.code);
  }
  const reason = [shortMessage, details, ...codes].filter(Boolean).join(" | ").replace(/\S*(https?:|\/ark_|ark_)\S*/g, "[url]");
  return reason ? `${name}: ${reason.slice(0, 240)}` : name;
}

export function createApi(deps: {
  desk: Desk;
  store: ArkivStore;
  publisher: Publisher;
  corsOrigin: string;
  mode: "live" | "memory";
  policyVersion: string;
  rootName: string;
  moderators: string[];
  /** "dev" while the stand-in in world-dev.ts is mounted, "world" once the real gates run. */
  world: "dev" | "world";
}) {
  const { desk, store, publisher, mode, policyVersion, rootName, world, moderators } = deps;
  const app = new Hono();

  const send = (value: unknown, status = 200) =>
    new Response(stringify(value), { status, headers: { "content-type": "application/json" } });
  const key = (raw: string): Hex => {
    if (!isHex(raw, { strict: true }) || raw.length !== 66) {
      throw new AppError(400, "invalid_key", "That is not an entity key.");
    }
    return raw;
  };

  app.use("/api/*", cors({ origin: deps.corsOrigin.split(","), allowMethods: ["GET", "POST"] }));

  app.onError((error, context) => {
    if (error instanceof AppError) {
      const reason = "reason" in error ? { reason: error.reason } : {};
      return context.json({ error: error.code, message: error.message, ...reason }, error.status);
    }
    if (error instanceof z.ZodError) {
      const fields = error.issues.map((issue) => issue.path.join(".")).join(", ");
      return context.json({ error: "invalid_input", message: `Check: ${fields}` }, 400);
    }
    console.error(`[api] ${context.req.method} ${context.req.path} failed: ${safeReason(error)}`);
    return context.json({ error: "internal", message: "Something went wrong." }, 500);
  });

  app.get("/api/health", (context) => context.json({ ok: true, mode, world, rootName, publisher: publisher.address, chainId: publisher.chainId }));
  app.get("/api/stats", async () => send(await desk.stats()));
  app.get("/api/ens/failures", (context) => context.json(desk.ensFailures()));
  // Public receipts: World checks, Arkiv entities and Sepolia transactions, newest first.
  app.get("/api/activity", (context) => {
    const subject = context.req.query("subject") || undefined;
    const limit = Math.min(Number(context.req.query("limit") ?? 50) || 50, 200);
    return context.json(activity.list({ subject, limit }));
  });

  /** What the frontend signs, and how each hash in it is computed. */
  app.get("/api/typed-data", (context) =>
    context.json({
      domain: DOMAIN,
      types: TYPES,
      policyVersion,
      hashing: {
        bodyHash: "keccak256(utf8(JSON.stringify({ question, topics })))",
        stanceHash: "keccak256(utf8(stance))",
        rulingHash: "keccak256(utf8(ruling))",
      },
    }),
  );

  app.post("/api/policies/join", async (context) => {
    const { key: policy, ensName } = await desk.acceptJoinPolicy(JoinPolicyBody.parse(await context.req.json()));
    return send({ policy, ensName }, 201);
  });

  app.get("/api/members/by-wallet/:wallet", async (context) => {
    const wallet = context.req.param("wallet");
    if (!isAddress(wallet)) throw new AppError(400, "invalid_wallet", "That is not a wallet address.");
    const hash = ownerHash(wallet as Address);
    const [member, creatorPolicy] = await Promise.all([
      store.findMemberByOwner(hash),
      store.findPolicy(hash, "docket-creation"),
    ]);
    if (!member) throw new AppError(404, "not_a_member", "This wallet has not joined.");
    return send({
      ...memberView(member),
      nameStatus: desk.nameStatus(member.ensName),
      canOpenDockets: Boolean(creatorPolicy),
      isModerator: moderators.includes(wallet.toLowerCase()),
    });
  });

  app.post("/api/policies/docket-creation", async (context) => {
    return send(await desk.acceptDocketPolicy(PolicyBody.parse(await context.req.json())), 201);
  });

  app.get("/api/dockets", async (context) => {
    const status = context.req.query("status");
    if (status && !["open", "closed", "closed-for-cause"].includes(status)) {
      throw new AppError(400, "invalid_status", "Unknown status.");
    }
    return send((await store.listDockets(status as DocketStatus | undefined)).map((docket) => docketView(docket)));
  });

  app.post("/api/dockets", async (context) => {
    return send(await desk.openDocket(OpenBody.parse(await context.req.json())), 201);
  });

  /** Lets a client confirm its hash before signing. */
  app.post("/api/dockets/body-hash", async (context) => {
    const { question, topics } = z
      .object({ question: z.string(), topics: z.array(z.string()) })
      .parse(await context.req.json());
    return context.json({ bodyHash: docketBodyHash(question, topics) });
  });

  app.get("/api/dockets/:key", async (context) => {
    const docket = await store.getDocket(key(context.req.param("key")));
    if (!docket) throw new AppError(404, "docket_not_found", "That docket does not exist or has expired.");
    return send(docketView(docket));
  });

  app.get("/api/dockets/:key/rules", async (context) => {
    const docket = await store.getDocket(key(context.req.param("key")));
    if (!docket) throw new AppError(404, "docket_not_found", "That docket does not exist or has expired.");
    return send({ ensName: docket.ensName, ...(await desk.liveRules(docket)) });
  });

  app.get("/api/dockets/:key/comments", async (context) => {
    const comments = await store.listComments(key(context.req.param("key")));
    return send(comments.map(commentView));
  });

  app.get("/api/dockets/:key/tally", async (context) => {
    const { docket, tally } = await desk.tally(key(context.req.param("key")));
    return send({ docket: docket.key, deadline: docket.deadline, ...tally });
  });

  /** FR9: aggregates only. No names, no hashes, no comment text. */
  app.get("/api/dockets/:key/insights", async (context) => {
    const { tally } = await desk.tally(key(context.req.param("key")));
    return send({ counted: tally.counted, topics: tally.topics });
  });

  app.get("/api/dockets/:key/archive", async (context) => {
    const archive = await desk.archive(key(context.req.param("key")));
    return send({ ...archive, docket: docketView(archive.docket), comments: archive.comments.map(commentView) });
  });

  /** Retry for a failed background upload. Public: it only publishes a closed record. */
  app.post("/api/dockets/:key/archive/publish", async (context) => {
    return send(await desk.publishArchive(key(context.req.param("key"))));
  });

  app.get("/api/dockets/:key/archive/verify", async (context) => {
    return send(await desk.verifyArchive(key(context.req.param("key"))));
  });

  app.post("/api/dockets/:key/close", async (context) => {
    const body = CloseBody.parse(await context.req.json());
    return send(await desk.closeDocket({ ...body, docket: key(context.req.param("key")) }));
  });

  app.post("/api/dockets/:key/moderate", async (context) => {
    const body = ModerateBody.parse(await context.req.json());
    return send(await desk.moderateDocket({ ...body, docket: key(context.req.param("key")) }));
  });

  app.post("/api/dockets/:key/archive", async (context) => {
    const body = ArchiveBody.parse(await context.req.json());
    return send(await desk.attachArchive({ ...body, docket: key(context.req.param("key")) }));
  });

  return app;
}
