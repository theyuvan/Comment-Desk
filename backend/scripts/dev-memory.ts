/**
 * Runs the real API on in-memory data so the frontend works with no keys or
 * funds. Nothing reaches Arkiv, ENS or Swarm, and /api/health reports
 * mode "memory" so the app can show a warning banner.
 *
 *   npm run dev:memory
 */
import { serve } from "@hono/node-server";
import { createApi } from "../src/api.ts";
import { Desk } from "../src/desk.ts";
import { DeskWorldHost } from "../src/host/desk-host.ts";
import { devWorldRoutes } from "../src/world-dev.ts";
import { MemoryArchiver, MemoryNaming, MemoryStore } from "../test/helpers.ts";

const store = new MemoryStore();
const policyVersion = "1";
const moderators = (process.env.MODERATOR_ADDRESSES ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) as `0x${string}`[];
const desk = new Desk(
  store,
  new MemoryNaming(),
  { policyVersion, graceDays: 7, maxCommentsPerTopic: 1, moderators },
  new MemoryArchiver(),
);

const app = createApi({
  desk,
  store,
  publisher: { address: "0x0000000000000000000000000000000000000000", chainId: 7794095 },
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  mode: "memory",
  policyVersion,
  rootName: "commentdesk.eth",
  moderators,
  world: "dev",
});
app.route("/", devWorldRoutes({ desk, store, host: new DeskWorldHost(desk, store) }));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, ({ port }) => {
  console.log(`In-memory demo API on http://localhost:${port}. Nothing is written to any network.`);
});
