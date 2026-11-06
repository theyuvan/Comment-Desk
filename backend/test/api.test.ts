import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { DeskWorldHost } from "../src/host/desk-host.ts";
import { devWorldRoutes } from "../src/world-dev.ts";
import { harness, newWallet, sign } from "./helpers.ts";

function api(context = harness()) {
  const app = createApi({
    desk: context.desk,
    store: context.store,
    publisher: { address: "0x1000000000000000000000000000000000000001", chainId: 7794095 },
    corsOrigin: "http://localhost:3000",
    mode: "memory",
    policyVersion: "1",
    rootName: "commentdesk.eth",
    moderators: [],
    world: "dev",
  });
  const host = new DeskWorldHost(context.desk, context.store);
  app.route("/", devWorldRoutes({ desk: context.desk, store: context.store, host }));
  return { ...context, app, host };
}

/** A browser: keeps the session cookie between requests. */
function browser(app: ReturnType<typeof api>["app"]) {
  let cookie = "";
  return async (path: string, body?: unknown) => {
    const response = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: response.status, body: await response.json() };
  };
}

async function joinThroughRoutes(client: ReturnType<typeof browser>, wallet: ReturnType<typeof newWallet>, handle: string) {
  const issuedAt = Date.now();
  const signature = await sign(wallet, "Join", { handle, policyVersion: "1", issuedAt: BigInt(issuedAt) });
  await client("/api/policies/join", { handle, issuedAt: String(issuedAt), signature });
  const request = await client("/api/world/requests", { purpose: "join", handle, wallet: wallet.address });
  return client("/api/world/verify/join", { result: { nonce: request.body.rp_context.nonce, subject: wallet.address } });
}

async function postThroughRoutes(client: ReturnType<typeof browser>, docketKey: string, topic = "emissions") {
  const request = await client("/api/world/requests", { purpose: "comment", docketKey, topic, text: "Words.", sentiment: "support" });
  if (request.status !== 200) return request;
  return client("/api/world/verify/comment", { result: { nonce: request.body.rp_context.nonce } });
}

describe("public API", () => {
  it("serves the signing schema", async () => {
    const { app } = api();
    const body = await (await app.request("/api/typed-data")).json();
    expect(body.domain.name).toBe("Comment Desk");
    expect(body.policyVersion).toBe("1");
    expect(Object.keys(body.types)).toContain("SignIn");
  });

  it("reports which World is connected", async () => {
    const { app } = api();
    expect(await (await app.request("/api/health")).json()).toMatchObject({ world: "dev", mode: "memory" });
  });

  it("returns bigints as strings and hides owner hashes", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const voter = newWallet();
    await context.join(voter, "ravi");
    await context.comment(voter, key);

    const docket = await (await context.app.request(`/api/dockets/${key}`)).json();
    expect(typeof docket.deadline).toBe("string");
    expect(docket.ownerHash).toBeUndefined();

    const comments = await (await context.app.request(`/api/dockets/${key}/comments`)).json();
    expect(comments[0].stance).toBe("I support this.");
    expect(comments[0].ownerHash).toBeUndefined();
  });

  it("keeps insights aggregate: no names, hashes or text", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const voter = newWallet();
    await context.join(voter, "ravi");
    await context.comment(voter, key, { stance: "A private thought." });

    const raw = await (await context.app.request(`/api/dockets/${key}/insights`)).text();
    expect(raw).toContain('"counted":1');
    expect(raw).not.toContain("ravi");
    expect(raw).not.toContain("A private thought");
    expect(raw).not.toContain(context.store.comments[0]!.ownerHash);
  });

  it("tally and stats agree", async () => {
    const context = harness({ maxCommentsPerTopic: 2 });
    const { app, ...rest } = api(context);
    const { key } = await rest.creator(newWallet());
    const voter = newWallet();
    await rest.join(voter, "ravi");
    await rest.comment(voter, key);
    await rest.comment(voter, key);

    const tally = await (await app.request(`/api/dockets/${key}/tally`)).json();
    const stats = await (await app.request("/api/stats")).json();
    expect(tally).toMatchObject({ counted: 1, stored: 2 });
    expect(stats).toMatchObject({ members: 2, dockets: 1, comments: 2, countedComments: 1 });
  });

  it("answers with stable error codes", async () => {
    const { app } = api();
    const missing = await app.request(`/api/dockets/0x${"ab".repeat(32)}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("docket_not_found");
    expect((await app.request("/api/dockets/nonsense")).status).toBe(400);
  });

  it("never exposes internal error detail", async () => {
    const context = harness();
    context.store.stats = async () => {
      throw new Error("https://rpc.example/secret-access-key failed");
    };
    const { app } = api(context);
    const response = await app.request("/api/stats");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-access-key");
  });
});

describe("the World seam", () => {
  it("joins through the same paths the World backend serves", async () => {
    const { app, store } = api();
    const client = browser(app);
    const joined = await joinThroughRoutes(client, newWallet(), "maya");
    expect(joined.body).toMatchObject({ ensName: "maya.commentdesk.eth", returning: false });
    expect(store.members[0]?.proofRef).toMatch(/^dev:/);
    expect((await client("/api/session")).body).toMatchObject({ ensName: "maya.commentdesk.eth", worldLinked: false });
  });

  it("signs the same human back in instead of minting a second name", async () => {
    const { app, store } = api();
    const wallet = newWallet();
    await joinThroughRoutes(browser(app), wallet, "maya");
    const client = browser(app);
    const request = await client("/api/world/requests", { purpose: "join", handle: "other", wallet: wallet.address });
    const again = await client("/api/world/verify/join", { result: { nonce: request.body.rp_context.nonce, subject: wallet.address } });
    expect(again.body).toMatchObject({ ensName: "maya.commentdesk.eth", returning: true });
    expect(store.members).toHaveLength(1);
  });

  it("restores a session from a passkey wallet signature", async () => {
    const { app } = api();
    const wallet = newWallet();
    await joinThroughRoutes(browser(app), wallet, "maya");
    const client = browser(app);
    expect((await client("/api/session")).body).toBeNull();
    const issuedAt = Date.now();
    const signature = await sign(wallet, "SignIn", { issuedAt: BigInt(issuedAt) });
    await client("/api/session/wallet", { issuedAt: String(issuedAt), signature });
    expect((await client("/api/session")).body).toMatchObject({ ensName: "maya.commentdesk.eth" });
    await client("/api/session/logout", {});
  });

  it("posts a comment and reports denials as { error, reason }", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const client = browser(context.app);
    await joinThroughRoutes(client, newWallet(), "ravi");

    expect((await postThroughRoutes(client, key)).body.ensName).toMatch(/^comment-1\./);
    const again = await postThroughRoutes(client, key);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ reason: "already_commented" });
  });

  it("refuses a comment with no session, and a reused request", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const denied = await postThroughRoutes(browser(context.app), key);
    expect(denied.status).toBe(401);
    expect(denied.body.reason).toBe("not_a_member");

    const client = browser(context.app);
    await joinThroughRoutes(client, newWallet(), "ravi");
    const request = await client("/api/world/requests", { purpose: "comment", docketKey: key, topic: "cost", text: "Words." });
    await client("/api/world/verify/comment", { result: { nonce: request.body.rp_context.nonce } });
    const reused = await client("/api/world/verify/comment", { result: { nonce: request.body.rp_context.nonce } });
    expect(reused.body.reason).toBe("request_expired");
  });

  it("discards an agent draft that changed after approval", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const client = browser(context.app);
    await joinThroughRoutes(client, newWallet(), "ravi");

    const changed = await client("/api/dev/agent-confirm", { docketKey: key, topic: "cost", text: "x", changedAfterApproval: true });
    expect(changed.body.reason).toBe("draft_changed");
    expect(context.store.comments).toHaveLength(0);

    const posted = await client("/api/dev/agent-confirm", { docketKey: key, topic: "cost", text: "Phase it in." });
    expect(posted.body.ensName).toMatch(/^comment-1\./);
    expect(context.store.comments[0]?.authorType).toBe("agent");
  });
});

describe("DeskWorldHost", () => {
  it("implements the contract the World branch calls", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const voter = newWallet();
    await context.signJoin(voter, "ravi");

    const member = await context.host.onMemberVerified({ proofRef: "idkit:4:abc", nullifier: "123" }, { handle: "ravi", wallet: voter.address });
    expect(member.ensName).toBe("ravi.commentdesk.eth");

    const docket = await context.host.getDocket(key);
    expect(docket).toMatchObject({ key, status: "open", credentialLevel: "soft", topics: ["emissions", "cost"] });
    expect(typeof docket?.deadline).toBe("number");
    expect(docket!.deadline).toBeLessThan(1e11);
    expect(await context.host.getDocket("truck-emissions-rule")).toBeNull();

    const comment = await context.host.onCommentVerified(
      { proofRef: "agentpass:def" },
      { memberRef: member.memberRef, docketKey: key, topic: "cost", text: "Approved words.", authorType: "agent" },
    );
    expect(comment).toEqual({ commentRef: expect.any(String), ensName: `comment-1.${docket!.ensName}` });
  });

  it("gives the agent the docket's question to draft against", async () => {
    const context = api();
    const { key } = await context.creator(newWallet());
    const docket = await context.host.getDocket(key);
    expect(docket?.question).toBeTruthy();
  });

  it("signs a returning human back in by their join nullifier, minting nothing", async () => {
    const context = api();
    const first = newWallet();
    await context.signJoin(first, "ravi");
    const member = await context.host.onMemberVerified({ proofRef: "idkit:4:abc", nullifier: "123" }, { handle: "ravi", wallet: first.address });

    // Same human, new passkey and handle, after World's own record was lost.
    const second = newWallet();
    await context.signJoin(second, "ravi-two");
    const again = await context.host.onMemberVerified({ proofRef: "idkit:4:xyz", nullifier: "123" }, { handle: "ravi-two", wallet: second.address });
    expect(again).toEqual({ memberRef: member.memberRef, ensName: "ravi.commentdesk.eth", returning: true });
    expect(await context.store.findMemberByEns("ravi-two.commentdesk.eth")).toBeUndefined();
  });
});
