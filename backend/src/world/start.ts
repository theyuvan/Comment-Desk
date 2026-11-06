import type { WorldGateHost } from "@commentdesk/shared";
import { buildApp } from "../app";
import { nowSec } from "../crypto";
import type { Deps } from "../deps";
import { WorldStore } from "../store";
import { loadConfig } from "./config";
import { createClaudeAgentModel } from "./agent-interview";
import { createWorldIdpClient } from "./oidc";
import { createPortalVerifier } from "./portal";

/**
 * The World module's one entry point: real IDKit 4 gates and World ID Agent Pass, served on
 * WORLD_PORT. Whatever records the results (Arkiv/ENS, or memory) comes in as `host`.
 */
export function startWorldGates(options: { host: WorldGateHost; signIn?: Deps["signIn"]; env?: NodeJS.ProcessEnv }) {
  const env = options.env ?? process.env;
  // PORT belongs to the main API; the gates take WORLD_PORT.
  const config = loadConfig({ ...env, PORT: env.WORLD_PORT ?? "4000" });
  const agentModel = createClaudeAgentModel(config.AGENT_MODEL);
  const app = buildApp({
    config,
    store: new WorldStore(config.DATA_FILE),
    host: options.host,
    portal: createPortalVerifier({ base: config.WORLD_ID_PORTAL_BASE, rpId: config.WORLD_ID_RP_ID }),
    oidc: createWorldIdpClient(config),
    now: nowSec,
    signIn: options.signIn,
    agentModel,
  });
  return app.listen(config.PORT, () => {
    console.log(`World gates on :${config.PORT}`);
    console.log(`  IDKit: ${config.WORLD_ID_ENVIRONMENT}, app ${config.WORLD_ID_APP_ID}, join credential ${config.WORLD_ID_JOIN_CREDENTIAL}`);
    console.log(`  Agent Pass: ${config.AGENT_PASS_ISSUER}, acr ${config.AGENT_PASS_ACR_VALUES.join(" | ")}`);
    console.log(`  Drafting agent: ${agentModel ? config.AGENT_MODEL : "off (set ANTHROPIC_API_KEY to enable)"}`);
  });
}
