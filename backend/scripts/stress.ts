/**
 * Stress test, top to bottom: the real World gates over HTTP, on the real Desk, with Arkiv,
 * ENS and Swarm in memory. Only the three things that need a phone are simulated: World App's
 * proof, the World ID portal's verdict, and the World IdP login.
 *
 *   npm run stress -w backend            # default load: 40 members
 *   npm run stress -w backend -- 1000 100   # 1000 members, 100 in flight at once
 *
 * Exits non-zero if any check fails.
 */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WorldRequestDto } from "../src/shared";
import { buildApp } from "../src/app.ts";
import { nowSec } from "../src/crypto.ts";
import type { Deps } from "../src/deps.ts";
import { DeskWorldHost } from "../src/host/desk-host.ts";
import { tally } from "../src/recount.ts";
import { toTallyComment } from "../src/desk.ts";
import { WorldStore } from "../src/store.ts";
import { loadConfig } from "../src/world/config.ts";
import type { AgentModel } from "../src/world/agent-interview.ts";
import type { StepUpClaims } from "../src/world/oidc.ts";
import { harness, newWallet, settle, type Wallet } from "../test/helpers.ts";
import { fakeIdkitResult } from "../test/world-helpers.ts";

const LOAD = Number(process.argv[2] ?? 40);
/** Members in flight at once. One machine opening hundreds of sockets in the same instant overflows the OS accept queue. */
const IN_FLIGHT = Number(process.argv[3] ?? 100);

/** Runs fn over items with at most `limit` running at once, keeping order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}
const ISSUER = "https://auth.world.org";
const ORB = "https://world.org/oidc/acr/orb";

// ---------- the system under test ----------

const desk = harness();
let offset = 0; // seconds added to the gates' clock, to reach expiry without waiting
const portal = { verdict: { success: true, environment: "production" } as { success: boolean; environment?: string; code?: string } };
const idp = {
  claims: (nonce: string): StepUpClaims => ({ iss: ISSUER, sub: `world-${randomBytes(4).toString("hex")}`, acr: ORB, auth_time: nowSec() + offset, jti: randomBytes(8).toString("hex"), nonce }),
  /** sub per member, so a member's later approvals come from the same World account. */
  subs: new Map<string, string>(),
  next: null as null | ((nonce: string) => StepUpClaims),
};

const config = loadConfig({
  SESSION_SECRET: randomBytes(32).toString("hex"),
  FRONTEND_ORIGIN: "http://localhost:3000",
  WORLD_ID_APP_ID: "app_stress",
  WORLD_ID_RP_ID: "rp_stress",
  WORLD_ID_SIGNING_KEY: `0x${randomBytes(32).toString("hex")}`,
  AGENT_PASS_CLIENT_ID: "client",
  AGENT_PASS_CLIENT_SECRET: "secret",
  AGENT_PASS_REDIRECT_URI: "http://localhost:3000/api/agent-pass/callback",
  AGENT_PASS_CONFIRM_TTL_SECONDS: "120",
});

const deps: Deps = {
  config,
  store: new WorldStore(null),
  host: new DeskWorldHost(desk.desk, desk.store),
  portal: { verify: async () => portal.verdict as never },
  oidc: {
    issuer: () => ISSUER,
    async authorizationUrl(p) {
      const url = new URL(`${ISSUER}/api/v1/authorize`);
      url.searchParams.set("state", p.state);
      return url;
    },
    async redeem(_url, checks) {
      const make = idp.next ?? idp.claims;
      idp.next = null;
      return make(checks.nonce);
    },
  },
  now: () => nowSec() + offset,
  signIn: (input) => desk.desk.signIn(input),
};

const server = buildApp(deps).listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;

// ---------- a browser and a phone ----------

type Res = { status: number; body: any; location: string | null };

function browser() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const form = typeof body === "string";
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        ...(body === undefined ? {} : { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, location: res.headers.get("location") };
  };
}
type Browser = ReturnType<typeof browser>;

/** World App: answers a request the backend signed, as this human. */
const phone = (req: WorldRequestDto, nullifier: string, tweak: Parameters<typeof fakeIdkitResult>[1] = {}) =>
  fakeIdkitResult(req, { nullifier, ...tweak });

let humans = 0;
const human = () => String(10n ** 20n + BigInt(++humans));

async function joinMember(handle: string, nullifier = human()) {
  const b = browser();
  const wallet = newWallet();
  await desk.signJoin(wallet, handle);
  const req = await b("POST", "/api/world/requests", { purpose: "join", handle, wallet: wallet.address });
  const res = await b("POST", "/api/world/verify/join", { result: phone(req.body, nullifier) });
  return { b, wallet, handle, nullifier, res, memberRef: res.body?.memberRef as string };
}

async function humanComment(b: Browser, docketKey: string, topic: string, text: string, nullifier: string, sentiment = "support") {
  const req = await b("POST", "/api/world/requests", { purpose: "comment", docketKey, topic, text, sentiment });
  if (req.status !== 200) return req;
  return b("POST", "/api/world/verify/comment", { result: phone(req.body, nullifier) });
}

async function agentDraft(b: Browser, docketKey: string, topic: string, text: string, sentiment = "oppose") {
  const token = (await b("POST", "/api/agent/tokens", { label: "stress" })).body.token as string;
  const auth = { authorization: `Bearer ${token}` };
  const draft = await b("POST", "/api/agent/drafts", { docketKey, topic, text, sentiment }, auth);
  return { token, auth, draft: draft.body, status: draft.status };
}

/** Starts Agent Pass for a draft; returns the state World would carry back. */
async function startApproval(b: Browser, draftKey: string) {
  const res = await b("POST", "/api/agent-pass/start", `draftKey=${encodeURIComponent(draftKey)}`);
  // Like a browser: follow the redirect to World, which carries the state back.
  const to = res.location ? new URL(res.location) : null;
  return { res, state: to?.origin === ISSUER ? to.searchParams.get("state") : null };
}

const outcome = (res: Res) => {
  const url = new URL(res.location ?? "http://x/");
  return { status: url.searchParams.get("agentpass"), reason: url.searchParams.get("reason") };
};

// ---------- reporting ----------

type Row = { section: string; name: string; ok: boolean; detail: string };
const rows: Row[] = [];
let section = "";
async function check(name: string, run: () => Promise<string | void>) {
  const started = performance.now();
  try {
    const detail = (await run()) ?? "";
    rows.push({ section, name, ok: true, detail: `${detail} (${Math.round(performance.now() - started)} ms)`.trim() });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    rows.push({ section, name, ok: false, detail: `${(err as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ""}` });
  }
}
function expect(cond: unknown, message: () => string): asserts cond {
  if (!cond) throw new Error(message());
}
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const reasonOf = (res: Res) => res.body?.reason ?? `http ${res.status}`;

// =====================================================================
section = "1. Journey, top to bottom";
// =====================================================================

const clerk = newWallet();
const { key: docket } = await desk.creator(clerk, "clerk");
let maya!: Awaited<ReturnType<typeof joinMember>>;
let mayaAgent!: Awaited<ReturnType<typeof agentDraft>>;

await check("no session before joining", async () => {
  const res = await browser()("GET", "/api/session");
  expect(res.body === null, () => `expected null, got ${JSON.stringify(res.body)}`);
});
await check("join: passkey policy, World proof, ENS name, session", async () => {
  maya = await joinMember("maya");
  expect(maya.res.status === 200, () => `join ${maya.res.status} ${reasonOf(maya.res)}`);
  expect(maya.res.body.ensName === "maya.commentdesk.eth" && maya.res.body.returning === false, () => JSON.stringify(maya.res.body));
  const session = await maya.b("GET", "/api/session");
  expect(session.body?.ensName === "maya.commentdesk.eth", () => "session doesn't carry the name");
  const member = await desk.store.getMember(maya.memberRef as never);
  expect(member?.nullifierHash === maya.nullifier, () => "Arkiv member doesn't hold the join nullifier");
  return maya.res.body.ensName;
});
await check("agent reads the docket, question included", async () => {
  const token = (await maya.b("POST", "/api/agent/tokens", { label: "reader" })).body.token;
  const res = await maya.b("GET", `/api/agent/dockets/${docket}`, undefined, { authorization: `Bearer ${token}` });
  expect(res.status === 200 && res.body.question === "Should the rule pass?", () => JSON.stringify(res.body));
  expect(JSON.stringify(res.body.topics) === '["emissions","cost"]', () => "topics");
});
await check("human comment: World proof binds text + position, posts to Arkiv", async () => {
  const res = await humanComment(maya.b, docket, "emissions", "Cut emissions now.", human(), "support");
  expect(res.status === 200, () => `${res.status} ${reasonOf(res)}`);
  const stored = desk.store.comments.find((c) => c.key === res.body.commentRef);
  expect(stored?.authorType === "human" && stored.sentiment === "support" && stored.stance === "Cut emissions now.", () => json(stored));
  expect(stored.proofRef.startsWith("idkit:4.0:") && stored.authorEns === "maya.commentdesk.eth", () => stored.proofRef);
  return res.body.ensName;
});
await check("agent comment: token drafts, member approves with Agent Pass, posts as agent.maya", async () => {
  mayaAgent = await agentDraft(maya.b, docket, "cost", "Phase it in over three years.", "oppose");
  expect(mayaAgent.status === 201 && mayaAgent.draft.sentiment === "oppose", () => JSON.stringify(mayaAgent.draft));
  expect(desk.store.comments.length === 1, () => "a draft must not post on its own");
  const { res, state } = await startApproval(maya.b, mayaAgent.draft.draftKey);
  expect(res.status === 303 && state, () => `start ${res.status} ${res.location}`);
  const done = await maya.b("GET", `/api/agent-pass/callback?code=c&state=${state}`);
  expect(outcome(done).status === "posted", () => `callback ${done.location}`);
  const stored = desk.store.comments.find((c) => c.topic === "cost");
  expect(stored?.authorType === "agent" && stored.sentiment === "oppose" && stored.authorEns === "agent.maya.commentdesk.eth", () => json(stored));
  expect(stored.proofRef.startsWith("agentpass:"), () => stored.proofRef);
  return stored.ensName;
});
await check("built-in agent interview: refuses once every topic is used", async () => {
  deps.agentModel = (async () => ({ content: [{ type: "text", text: "Which topic?" }], stop_reason: "end_turn" })) as never as AgentModel;
  const res = await maya.b("POST", "/api/agent/interview", { docketKey: docket, message: "hi" });
  expect(res.status === 409 && res.body.reason === "already_commented", () => `${res.status} ${reasonOf(res)}`);
});
await check("tally: 2 counted, 1 human + 1 agent, recount agrees", async () => {
  await settle();
  const live = await desk.desk.tally(docket);
  const recount = tally(live.docket, live.comments.map(toTallyComment));
  expect(live.tally.counted === 2 && JSON.stringify(recount) === JSON.stringify(live.tally), () => JSON.stringify(live.tally));
  const human = live.tally.topics.reduce((n, t) => n + t.human, 0);
  const agent = live.tally.topics.reduce((n, t) => n + t.agent, 0);
  expect(human === 1 && agent === 1, () => `human ${human} agent ${agent}`);
});
await check("sign out, sign back in with the passkey wallet", async () => {
  await maya.b("POST", "/api/session/logout", {});
  expect((await maya.b("GET", "/api/session")).body === null, () => "still signed in");
  const issuedAt = BigInt(Date.now());
  const signature = await signIn(maya.wallet, issuedAt);
  const res = await maya.b("POST", "/api/session/wallet", { issuedAt: String(issuedAt), signature });
  expect(res.status === 200 && res.body.ensName === "maya.commentdesk.eth", () => `${res.status} ${reasonOf(res)}`);
  expect((await maya.b("GET", "/api/session")).body?.ensName === "maya.commentdesk.eth", () => "no session after sign-in");
});

async function signIn(wallet: Wallet, issuedAt: bigint) {
  const { sign } = await import("../test/helpers.ts");
  return sign(wallet, "SignIn", { issuedAt });
}

// =====================================================================
section = "2. Denied paths: human";
// =====================================================================

const ravi = await joinMember("ravi");

await check("comment without a session", async () => {
  const res = await browser()("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "emissions", text: "x" });
  expect(res.status === 401 && res.body.reason === "not_a_member", () => reasonOf(res));
});
await check("World portal rejects the proof: nothing posts, proof not burned", async () => {
  portal.verdict = { success: false, code: "invalid_proof" };
  const nullifier = human();
  const res = await humanComment(ravi.b, docket, "emissions", "Rejected.", nullifier);
  portal.verdict = { success: true, environment: "production" };
  expect(res.body.reason === "proof_invalid", () => reasonOf(res));
  const retry = await humanComment(ravi.b, docket, "emissions", "Accepted now.", nullifier);
  expect(retry.status === 200, () => `retry ${reasonOf(retry)}`);
});
await check("one comment per human per topic (nullifier reuse)", async () => {
  const res = await humanComment(ravi.b, docket, "emissions", "Again.", human());
  expect(res.status === 409 && res.body.reason === "already_commented", () => reasonOf(res));
});
await check("proof bound to other words", async () => {
  const req = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "Mine.", sentiment: "support" });
  const res = await ravi.b("POST", "/api/world/verify/comment", { result: phone(req.body, human(), { signal: req.body.signal.replace("|", "|x") }) });
  expect(res.body.reason === "signal_mismatch", () => reasonOf(res));
});
await check("proof from the Simulator against a production app", async () => {
  const req = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "Sim.", sentiment: "support" });
  const res = await ravi.b("POST", "/api/world/verify/comment", { result: phone(req.body, human(), { environment: "staging" }) });
  expect(res.body.reason === "wrong_environment", () => reasonOf(res));
});
await check("expired request, then replay of the same result", async () => {
  const req = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "Late.", sentiment: "support" });
  const result = phone(req.body, human());
  offset = config.WORLD_ID_REQUEST_TTL_SECONDS + 5;
  const late = await ravi.b("POST", "/api/world/verify/comment", { result });
  offset = 0;
  const replay = await ravi.b("POST", "/api/world/verify/comment", { result });
  expect(late.body.reason === "request_expired" && replay.body.reason === "request_replayed", () => `${reasonOf(late)} / ${reasonOf(replay)}`);
});
await check("proof started in one session, redeemed in another", async () => {
  const req = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "Mine.", sentiment: "support" });
  const res = await maya.b("POST", "/api/world/verify/comment", { result: phone(req.body, human()) });
  expect(res.body.reason === "session_mismatch", () => reasonOf(res));
});
await check("invalid position and oversized text are refused before a proof is spent", async () => {
  const bad = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "x", sentiment: "maybe" });
  const long = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "cost", text: "x".repeat(4001) });
  const topic = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "nope", text: "x" });
  expect(bad.status === 400 && long.body.reason === "invalid_text" && topic.body.reason === "unknown_topic", () => `${reasonOf(bad)} / ${reasonOf(long)} / ${reasonOf(topic)}`);
});
await check("unknown and malformed docket keys", async () => {
  const res = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: "truck-emissions-rule", topic: "cost", text: "x" });
  const hex = await ravi.b("POST", "/api/world/requests", { purpose: "comment", docketKey: `0x${"ab".repeat(32)}`, topic: "cost", text: "x" });
  expect(res.status === 404 && hex.status === 404, () => `${reasonOf(res)} / ${reasonOf(hex)}`);
});
await check("comment after the deadline is refused", async () => {
  await desk.acceptPolicy(clerk);
  const short = await desk.open(clerk, "short-rule", BigInt(Date.now() + 1500));
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const res = await humanComment(ravi.b, short.key, "emissions", "Too late.", human());
  expect(res.body.reason === "docket_closed", () => reasonOf(res));
});

// =====================================================================
section = "3. Denied paths: join";
// =====================================================================

await check("handle already taken", async () => {
  const wallet = newWallet();
  const signed = await desk.signJoin(wallet, "maya").then(() => "signed", (err: Error) => err.message);
  expect(/taken/.test(signed), () => `policy step: ${signed}`);
});
await check("join without the signed join policy (desk reason shown)", async () => {
  const b = browser();
  const wallet = newWallet();
  const req = await b("POST", "/api/world/requests", { purpose: "join", handle: "nopolicy", wallet: wallet.address });
  const res = await b("POST", "/api/world/verify/join", { result: phone(req.body, human()) });
  expect(res.body.reason === "join_policy_required", () => reasonOf(res));
});
await check("same human, new passkey + handle: signed back in, no second name", async () => {
  const before = desk.store.members.length;
  const again = await joinMember("maya-two", maya.nullifier);
  expect(again.res.body.returning === true && again.res.body.ensName === "maya.commentdesk.eth", () => JSON.stringify(again.res.body));
  expect(desk.store.members.length === before, () => "a second member was created");
});
await check("same human after the World store is wiped: Arkiv still knows them", async () => {
  const saved = structuredClone(deps.store.data.nullifiers);
  for (const key of Object.keys(deps.store.data.nullifiers)) delete deps.store.data.nullifiers[key];
  const before = desk.store.members.length;
  const again = await joinMember("maya-three", maya.nullifier);
  Object.assign(deps.store.data.nullifiers, saved);
  expect(again.res.body.returning === true && desk.store.members.length === before, () => JSON.stringify(again.res.body));
});
await check("bad handle and bad wallet", async () => {
  const b = browser();
  const handle = await b("POST", "/api/world/requests", { purpose: "join", handle: "No!" });
  const wallet = await b("POST", "/api/world/requests", { purpose: "join", handle: "okay", wallet: "0x123" });
  expect(handle.body.reason === "invalid_handle" && wallet.body.reason === "invalid_wallet", () => `${reasonOf(handle)} / ${reasonOf(wallet)}`);
});

// =====================================================================
section = "4. Denied paths: agent";
// =====================================================================

const priya = await joinMember("priya");
await humanComment(priya.b, docket, "emissions", "Yes.", human());

async function agentAttempt(name: string, prepare: (state: string, draftKey: string, auth: Record<string, string>) => Promise<string | void>, expected: string) {
  await check(name, async () => {
    const draft = await agentDraft(priya.b, docket, "cost", `Draft for: ${name}`);
    const { state } = await startApproval(priya.b, draft.draft.draftKey);
    expect(state, () => "no state");
    const query = (await prepare(state, draft.draft.draftKey, draft.auth)) ?? `code=c&state=${state}`;
    const res = await priya.b("GET", `/api/agent-pass/callback?${query}`);
    const got = outcome(res);
    expect(got.status === "denied" && got.reason === expected, () => `got ${got.status}/${got.reason}`);
    const stored = desk.store.comments.filter((c) => c.topic === "cost" && c.authorEns.includes("priya"));
    expect(stored.length === 0, () => "something posted");
    return expected;
  });
}

await agentAttempt("cancel at World", async (state) => `error=access_denied&state=${state}`, "cancelled");
await agentAttempt("agent rewrites the text mid-approval", async (_s, draftKey, auth) => {
  await priya.b("PATCH", `/api/agent/drafts/${draftKey}`, { text: "Something never approved." }, auth);
}, "draft_changed");
await agentAttempt("agent flips only the position mid-approval", async (_s, draftKey, auth) => {
  await priya.b("PATCH", `/api/agent/drafts/${draftKey}`, { text: "Draft for: agent flips only the position mid-approval", sentiment: "support" }, auth);
}, "draft_changed");
await agentAttempt("approval window expires", async () => {
  offset = config.AGENT_PASS_CONFIRM_TTL_SECONDS + 5;
}, "confirm_expired");
offset = 0;
await agentAttempt("World says assurance below Orb", async () => {
  idp.next = (nonce) => ({ ...idp.claims(nonce), acr: "https://world.org/oidc/acr/device" });
}, "acr_insufficient");
await agentAttempt("stale World login (not a fresh check)", async () => {
  idp.next = (nonce) => ({ ...idp.claims(nonce), auth_time: nowSec() - 3600 });
}, "not_fresh");
await agentAttempt("another browser finishes the approval", async (state) => {
  const res = await maya.b("GET", `/api/agent-pass/callback?code=c&state=${state}`);
  return `code=c&state=${state}#${outcome(res).reason}`;
}, "confirm_replayed");
await check("an agent token cannot post or approve", async () => {
  const draft = await agentDraft(priya.b, docket, "cost", "Token tries to post.");
  const verify = await fetch(`${base}/api/world/verify/comment`, {
    method: "POST",
    headers: { "content-type": "application/json", ...draft.auth },
    body: JSON.stringify({ result: {} }),
  }).then((r) => r.json() as Promise<{ reason: string }>);
  const start = await fetch(`${base}/api/agent-pass/start`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...draft.auth }, body: `draftKey=${draft.draft.draftKey}` });
  expect(verify.reason === "not_a_member", () => `verify: ${verify.reason}`);
  expect(new URL(start.headers.get("location")!).searchParams.get("reason") === "not_a_member", () => "start accepted a bearer token");
});
await check("approval linked to one World account; a different account is refused", async () => {
  const draft = await agentDraft(priya.b, docket, "cost", "Linked account.");
  const first = await startApproval(priya.b, draft.draft.draftKey);
  idp.next = (nonce) => ({ ...idp.claims(nonce), sub: "priya-world" });
  const ok = outcome(await priya.b("GET", `/api/agent-pass/callback?code=c&state=${first.state}`));
  expect(ok.status === "posted", () => `first approval: ${ok.reason}`);

  const docket2 = (await desk.open(clerk, "second-rule")).key;
  const next = await agentDraft(priya.b, docket2, "cost", "Second docket.");
  const second = await startApproval(priya.b, next.draft.draftKey);
  idp.next = (nonce) => ({ ...idp.claims(nonce), sub: "someone-else" });
  const denied = outcome(await priya.b("GET", `/api/agent-pass/callback?code=c&state=${second.state}`));
  expect(denied.reason === "identity_mismatch", () => `second approval: ${denied.status}/${denied.reason}`);
});

// =====================================================================
section = "5. Concurrency attacks";
// =====================================================================

await check("same proof submitted 25 times at once: exactly one posts", async () => {
  const m = await joinMember(`race-a`);
  const req = await m.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "emissions", text: "Once.", sentiment: "support" });
  const result = phone(req.body, human());
  const all = await Promise.all(Array.from({ length: 25 }, () => m.b("POST", "/api/world/verify/comment", { result })));
  const ok = all.filter((r) => r.status === 200).length;
  const posted = desk.store.comments.filter((c) => c.authorEns === "race-a.commentdesk.eth").length;
  expect(ok === 1 && posted === 1, () => `${ok} accepted, ${posted} on Arkiv`);
  return `${all.length - ok} refused`;
});
await check("one human, 15 different requests on one topic at once: exactly one posts", async () => {
  const m = await joinMember(`race-b`);
  const nullifier = human();
  const reqs = await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      m.b("POST", "/api/world/requests", { purpose: "comment", docketKey: docket, topic: "emissions", text: `Try ${i}.`, sentiment: "support" }),
    ),
  );
  const all = await Promise.all(reqs.map((req) => m.b("POST", "/api/world/verify/comment", { result: phone(req.body, nullifier) })));
  const posted = desk.store.comments.filter((c) => c.authorEns === "race-b.commentdesk.eth").length;
  expect(all.filter((r) => r.status === 200).length === 1 && posted === 1, () => `${posted} on Arkiv`);
});
await check("human and agent paths race on the same topic: exactly one posts", async () => {
  const m = await joinMember(`race-c`);
  const draft = await agentDraft(m.b, docket, "cost", "Agent version.");
  const { state } = await startApproval(m.b, draft.draft.draftKey);
  const [typed, approved] = await Promise.all([
    humanComment(m.b, docket, "cost", "Typed version.", human()),
    m.b("GET", `/api/agent-pass/callback?code=c&state=${state}`),
  ]);
  const posted = desk.store.comments.filter((c) => c.topic === "cost" && c.authorEns.endsWith("race-c.commentdesk.eth")).length;
  expect(posted === 1, () => `${posted} posted (typed ${typed.status}, agent ${outcome(approved).status})`);
});
await check("callback replayed 20 times at once: exactly one posts", async () => {
  const m = await joinMember(`race-d`);
  const draft = await agentDraft(m.b, docket, "cost", "Replay me.");
  const { state } = await startApproval(m.b, draft.draft.draftKey);
  const all = await Promise.all(Array.from({ length: 20 }, () => m.b("GET", `/api/agent-pass/callback?code=c&state=${state}`)));
  const posted = all.filter((r) => outcome(r).status === "posted").length;
  const stored = desk.store.comments.filter((c) => c.authorEns === "agent.race-d.commentdesk.eth").length;
  expect(posted === 1 && stored === 1, () => `${posted} posted, ${stored} on Arkiv`);
});
await check("10 different humans race for one handle: exactly one name", async () => {
  const all = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const b = browser();
      const wallet = newWallet();
      const signed = await desk.signJoin(wallet, "popular").then(() => true, () => false);
      if (!signed) return { status: 409 };
      const req = await b("POST", "/api/world/requests", { purpose: "join", handle: "popular", wallet: wallet.address });
      return b("POST", "/api/world/verify/join", { result: phone(req.body, human()) });
    }),
  );
  const names = desk.store.members.filter((m) => m.ensName === "popular.commentdesk.eth").length;
  expect(names === 1 && all.filter((r) => r.status === 200).length === 1, () => `${names} members named popular`);
});
await check("one human races 8 joins with different handles: exactly one name", async () => {
  const nullifier = human();
  const before = desk.store.members.length;
  const all = await Promise.all(Array.from({ length: 8 }, (_, i) => joinMember(`twin-${i}`, nullifier)));
  const created = desk.store.members.length - before;
  const refs = new Set(all.filter((j) => j.res.status === 200).map((j) => j.memberRef));
  expect(created === 1 && refs.size === 1, () => `${created} members created, ${refs.size} distinct sessions`);
});

// =====================================================================
section = `6. Load: ${LOAD} members, every topic, ${IN_FLIGHT} in flight`;
// =====================================================================

const loadDocket = (await desk.open(clerk, "load-rule")).key;
await check(`${LOAD} members join`, async () => {
  const started = performance.now();
  const joined = await pool(Array.from({ length: LOAD }, (_, i) => i), IN_FLIGHT, (i) => joinMember(`load-${i}`));
  const failed = joined.filter((j) => j.res.status !== 200);
  expect(failed.length === 0, () => `${failed.length} failed: ${reasonOf(failed[0]!.res)}`);
  (globalThis as { loaders?: typeof joined }).loaders = joined;
  return `${Math.round(LOAD / ((performance.now() - started) / 1000))} joins/s`;
});
await check(`${LOAD * 2} comments in parallel, half human, half agent`, async () => {
  const loaders = (globalThis as { loaders?: Awaited<ReturnType<typeof joinMember>>[] }).loaders!;
  const started = performance.now();
  const results = await pool(
    loaders, IN_FLIGHT, async (m, i) => {
      const typed = await humanComment(m.b, loadDocket, "emissions", `Member ${i} typed.`, human(), i % 2 ? "support" : "oppose");
      const draft = await agentDraft(m.b, loadDocket, "cost", `Member ${i} via agent.`, i % 3 ? "neutral" : "support");
      const { state } = await startApproval(m.b, draft.draft.draftKey);
      idp.subs.set(m.handle, `load-sub-${i}`);
      const approved = outcome(await m.b("GET", `/api/agent-pass/callback?code=c&state=${state}`));
      return typed.status === 200 && approved.status === "posted" ? null : `${m.handle}: typed ${reasonOf(typed)}, agent ${approved.reason}`;
    },
  );
  const failed = results.filter(Boolean);
  expect(failed.length === 0, () => `${failed.length} failed, e.g. ${failed[0]}`);
  return `${Math.round((LOAD * 2) / ((performance.now() - started) / 1000))} comments/s`;
});
await check("load tally matches a recount, with no duplicates", async () => {
  await settle();
  const live = await desk.desk.tally(loadDocket);
  const recount = tally(live.docket, live.comments.map(toTallyComment));
  expect(live.tally.counted === LOAD * 2 && live.tally.stored === LOAD * 2, () => `counted ${live.tally.counted}, stored ${live.tally.stored}`);
  expect(JSON.stringify(recount) === JSON.stringify(live.tally), () => "recount differs");
  const [emissions, cost] = live.tally.topics;
  expect(emissions!.human === LOAD && cost!.agent === LOAD, () => `human ${emissions!.human}, agent ${cost!.agent}`);
  return `${live.tally.counted} counted`;
});

// =====================================================================
section = "7. Record integrity (what Arkiv would publish)";
// =====================================================================

await check("no raw wallet address anywhere in member, policy, docket or comment records", async () => {
  const published = JSON.stringify([desk.store.members, desk.store.policies, desk.store.dockets, desk.store.comments], (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  ).toLowerCase();
  const wallets = [clerk.address, maya.wallet.address, ravi.wallet.address, priya.wallet.address].map((a) => a.toLowerCase().slice(2));
  const leaked = wallets.filter((w) => published.includes(w));
  expect(leaked.length === 0, () => `${leaked.length} wallets found in public records`);
});
await check("every comment carries a World proof reference and a valid position", async () => {
  const bad = desk.store.comments.filter((c) => !/^(idkit:4.0:|agentpass:)[0-9a-f]{64}$/.test(c.proofRef) || !["support", "oppose", "neutral"].includes(c.sentiment));
  expect(bad.length === 0, () => `${bad.length} comments, e.g. ${JSON.stringify(bad[0]?.proofRef)}`);
  return `${desk.store.comments.length} comments`;
});
await check("no proof reference is used twice", async () => {
  const refs = desk.store.comments.map((c) => c.proofRef);
  expect(new Set(refs).size === refs.length, () => `${refs.length - new Set(refs).size} reused`);
});
await check("no member holds two counted comments on one topic of one docket", async () => {
  const seen = new Set<string>();
  for (const c of desk.store.comments.filter((c) => c.ordinal === 1)) {
    const key = `${c.docketKey}|${c.ownerHash}|${c.topic}`;
    expect(!seen.has(key), () => `duplicate counted comment ${key}`);
    seen.add(key);
  }
});
await check("one member per World join nullifier", async () => {
  const nullifiers = desk.store.members.map((m) => m.nullifierHash);
  expect(new Set(nullifiers).size === nullifiers.length, () => "two members share a nullifier");
  return `${desk.store.members.length} members`;
});

// ---------- report ----------

server.close();
let current = "";
for (const row of rows) {
  if (row.section !== current) console.log(`\n${(current = row.section)}`);
  console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? `  —  ${row.detail}` : ""}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
