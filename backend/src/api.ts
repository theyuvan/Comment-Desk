import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import type { ArkivStore, CommentRecord, DocketRecord, DocketStatus, MemberRecord } from "./arkiv/store.ts";
import { DOMAIN, TYPES } from "./auth.ts";
import { AppError, ownerHash } from "./core.ts";
import { docketBodyHash, submissionKey, type Desk } from "./desk.ts";
import type { Publisher } from "./recount-client.ts";

const hex = z.custom<Hex>((value) => typeof value === "string" && isHex(value));
const bytes32 = z.custom<Hex>((value) => typeof value === "string" && isHex(value, { strict: true }) && value.length === 66);
const millis = z.coerce.bigint().positive();

const JoinBody = z.object({ handle: z.string(), issuedAt: millis, signature: hex, worldProof: z.unknown() });
const PolicyBody = z.object({ issuedAt: millis, signature: hex });
const OpenBody = z.object({
  label: z.string(),
  title: z.string(),
  question: z.string(),
  topics: z.array(z.string()),
  deadline: millis,
  credentialLevel: z.enum(["proof_of_human", "proof_of_presence"]),
  issuedAt: millis,
  signature: hex,
});
const CommentBody = z.object({
  topic: z.string(),
  sentiment: z.string(),
  stance: z.string(),
  authorType: z.enum(["human", "agent"]),
  issuedAt: millis,
  signature: hex,
  worldProof: z.unknown(),
});
const KeyBody = z.object({
  wallet: z.string().refine((value) => isAddress(value)),
  topic: z.string(),
  sentiment: z.string(),
  stanceHash: bytes32,
  authorType: z.enum(["human", "agent"]),
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

export function createApi(deps: {
  desk: Desk;
  store: ArkivStore;
  publisher: Publisher;
  corsOrigin: string;
  mode: "live" | "memory";
  policyVersion: string;
  rootName: string;
}) {
  const { desk, store, publisher, mode, policyVersion, rootName } = deps;
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
    // Only the name: provider messages can contain the keyed RPC URL.
    console.error(`[api] ${context.req.method} ${context.req.path} failed: ${(error as Error).name}`);
    return context.json({ error: "internal", message: "Something went wrong." }, 500);
  });

  app.get("/api/health", (context) => context.json({ ok: true, mode, rootName, publisher: publisher.address, chainId: publisher.chainId }));
  app.get("/api/stats", async () => send(await desk.stats()));
  app.get("/api/ens/failures", (context) => context.json(desk.ensFailures()));

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

  app.post("/api/members", async (context) => {
    const body = JoinBody.parse(await context.req.json());
    return send(await desk.join({ ...body, proof: body.worldProof }), 201);
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
    return send({ ...memberView(member), canOpenDockets: Boolean(creatorPolicy) });
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

  app.get("/api/dockets/:key/comments", async (context) => {
    const comments = await store.listComments(key(context.req.param("key")));
    return send(comments.map(commentView));
  });

  /**
   * The value a World proof must be bound to: the signal for humans, the draft
   * key for agents. Change one character of the comment and this changes.
   */
  app.post("/api/dockets/:key/submission-key", async (context) => {
    const body = KeyBody.parse(await context.req.json());
    return context.json({
      submissionKey: submissionKey({
        docket: key(context.req.param("key")),
        topic: body.topic,
        sentiment: body.sentiment,
        stanceHash: body.stanceHash,
        authorType: body.authorType,
        owner: ownerHash(body.wallet as Address),
      }),
    });
  });

  app.post("/api/dockets/:key/comments", async (context) => {
    const body = CommentBody.parse(await context.req.json());
    return send(
      await desk.submitComment({ ...body, docket: key(context.req.param("key")), proof: body.worldProof }),
      201,
    );
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
