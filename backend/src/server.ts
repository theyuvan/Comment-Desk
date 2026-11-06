import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApi } from "./api.ts";
import { LiveArkivStore } from "./arkiv/store.ts";
import { ArkivWriter } from "./arkiv/writer.ts";
import { loadConfig } from "./config.ts";
import { Desk } from "./desk.ts";
import { EnsNaming } from "./ens/naming.ts";
import { devWorldGate, unavailableWorldGate } from "./world.ts";

const config = loadConfig();

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

// The World integration replaces this line.
const world = config.WORLD_GATE === "dev" ? devWorldGate : unavailableWorldGate;
if (config.WORLD_GATE === "dev") console.warn("[world] DEV GATE: proofs are not checked. Records are marked dev:");

const desk = new Desk(store, naming, world, {
  policyVersion: config.POLICY_VERSION,
  graceDays: config.GRACE_DAYS,
  maxCommentsPerTopic: config.MAX_COMMENTS_PER_TOPIC,
  moderators: [...config.moderators, ...(moderator ? [moderator.address.toLowerCase() as Address] : [])],
});

const app = createApi({
  desk,
  store,
  publisher: { address: writer.account.address, chainId: 7794095 },
  corsOrigin: config.CORS_ORIGIN,
});

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`Comment Desk API on http://localhost:${port}`);
  console.log(`Arkiv publisher ${writer.account.address}, ENS root ${config.rootName}`);
});
