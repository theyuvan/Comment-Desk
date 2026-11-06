import { dirname, join } from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { WorldStore } from "./store";
import { StubHost } from "./host/stub-host";
import { createPortalVerifier } from "./world/portal";
import { createWorldIdpClient } from "./world/oidc";
import { nowSec } from "./crypto";

const config = loadConfig();

const app = buildApp({
  config,
  store: new WorldStore(config.DATA_FILE),
  // TODO(arkiv/ens half): swap for the real host that writes Arkiv entities and mints ENSv2 names.
  host: StubHost.withDemoDockets(undefined, join(dirname(config.DATA_FILE), "stub-host.json")),
  portal: createPortalVerifier({ base: config.WORLD_ID_PORTAL_BASE, rpId: config.WORLD_ID_RP_ID }),
  oidc: createWorldIdpClient(config),
  now: nowSec,
});

app.listen(config.PORT, () => {
  console.log(`Comment Desk backend on :${config.PORT}`);
  console.log(`  World ID: ${config.WORLD_ID_ENVIRONMENT}, app ${config.WORLD_ID_APP_ID}, join credential ${config.WORLD_ID_JOIN_CREDENTIAL}`);
  console.log(`  Agent Pass issuer: ${config.AGENT_PASS_ISSUER}, acr ${config.AGENT_PASS_ACR_VALUES.join(" | ")}`);
});
