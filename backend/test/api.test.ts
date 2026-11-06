import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { AppError } from "../src/core.ts";
import { harness, newWallet } from "./helpers.ts";

function api(context = harness()) {
  const app = createApi({
    desk: context.desk,
    store: context.store,
    publisher: { address: "0x1000000000000000000000000000000000000001", chainId: 7794095 },
    corsOrigin: "http://localhost:3000",
    mode: "memory",
    policyVersion: "1",
    rootName: "commentdesk.eth",
  });
  return { ...context, app };
}

describe("public API", () => {
  it("serves the signing schema", async () => {
    const { app } = api();
    const body = await (await app.request("/api/typed-data")).json();
    expect(body.domain.name).toBe("Comment Desk");
    expect(Object.keys(body.types)).toContain("SubmitComment");
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
    const context = api();
    const { key } = await context.creator(newWallet());
    const voter = newWallet();
    await context.join(voter, "ravi");
    await context.comment(voter, key);
    await context.comment(voter, key);

    const tally = await (await context.app.request(`/api/dockets/${key}/tally`)).json();
    const stats = await (await context.app.request("/api/stats")).json();
    expect(tally).toMatchObject({ counted: 1, stored: 2 });
    expect(stats).toMatchObject({ members: 2, dockets: 1, comments: 2, countedComments: 1 });
  });

  it("answers with stable error codes", async () => {
    const { app } = api();
    const missing = await app.request(`/api/dockets/0x${"ab".repeat(32)}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("docket_not_found");
    expect((await app.request("/api/dockets/nonsense")).status).toBe(400);
    const invalid = await app.request("/api/members", { method: "POST", body: "{}" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("invalid_input");
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

  it("maps a refused gate to its status and reason", async () => {
    const context = harness();
    context.world.deny = new AppError(503, "world_unavailable", "Not connected.");
    const { app } = api(context);
    const wallet = newWallet();
    const issuedAt = Date.now();
    const { sign } = await import("./helpers.ts");
    const signature = await sign(wallet, "Join", { handle: "maya", policyVersion: "1", issuedAt: BigInt(issuedAt) });
    const response = await app.request("/api/members", {
      method: "POST",
      body: JSON.stringify({ handle: "maya", issuedAt: String(issuedAt), signature, worldProof: { human: "a" } }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("world_unavailable");
  });
});
