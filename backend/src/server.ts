import { join } from "node:path";
import { serve } from "@hono/node-server";
import { activity } from "./activity.ts";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApi } from "./api.ts";
import { LiveArkivStore } from "./arkiv/store.ts";
import { ArkivWriter } from "./arkiv/writer.ts";
import { loadConfig } from "./config.ts";
import { Desk } from "./desk.ts";
import { EnsNaming } from "./ens/naming.ts";
import { BeeArchiver, GATEWAY_BATCH_ID } from "./swarm.ts";
import { DeskWorldHost } from "./host/desk-host.ts";
import { devWorldRoutes } from "./world-dev.ts";
import { startWorldGates } from "./world/start.ts";

const config = loadConfig();
activity.persistTo(join(config.DATA_DIR, "activity.json"));

const writer = new ArkivWriter({
  account: privateKeyToAccount(config.ARKIV_PRIVATE_KEY),
  accessKey: config.ARKIV_ACCESS_KEY,
  maxFeeWei: config.ARKIV_MAX_FEE_WEI,
  journalPath: join(config.DATA_DIR, "arkiv-journal.jsonl"),
});
const store = new LiveArkivStore(writer);
await writer.reconcile((id) => store.opExists(id), config.ARKIV_ACK_UNRESOLVED === "1");

const moderator = config.ENS_MODERATOR_PRIVATE_KEY ? privateKeyToAccount(config.ENS_MODERATOR_PRIVATE_KEY) : undefined;
const naming = new EnsNaming({
  rpcUrl: config.SEPOLIA_RPC_URL,
  rootName: config.rootName,
  operator: privateKeyToAccount(config.ENS_OPERATOR_PRIVATE_KEY),
  moderator,
  moderators: config.moderators,
});

const archiver = new BeeArchiver({
  beeUrl: config.SWARM_BEE_URL,
  batchId: config.SWARM_BATCH_ID ?? GATEWAY_BATCH_ID,
});

const desk = new Desk(store, naming, {
  policyVersion: config.POLICY_VERSION,
  graceDays: config.GRACE_DAYS,
  maxCommentsPerTopic: config.MAX_COMMENTS_PER_TOPIC,
  moderators: [...config.moderators, ...(moderator ? [moderator.address.toLowerCase() as Address] : [])],
}, archiver);

const moderators = [...config.moderators, ...(moderator ? [moderator.address.toLowerCase()] : [])];
const host = new DeskWorldHost(desk, store);
const useDevWorld = config.WORLD_GATE === "dev";

const app = createApi({
  desk,
  store,
  publisher: { address: writer.account.address, chainId: 7794095 },
  corsOrigin: config.CORS_ORIGIN,
  mode: "live",
  policyVersion: config.POLICY_VERSION,
  rootName: config.rootName,
  moderators,
  world: useDevWorld ? "dev" : "world",
});

if (useDevWorld) {
  console.warn("[world] DEV STAND-IN: proofs are not checked. Records are marked dev:");
  app.route("/", devWorldRoutes({ desk, store, host }));
} else {
  startWorldGates({ host, signIn: (input) => desk.signIn(input) });
}

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`Comment Desk API on http://localhost:${port}`);
  console.log(`Arkiv publisher ${writer.account.address}, ENS root ${config.rootName}`);
});
