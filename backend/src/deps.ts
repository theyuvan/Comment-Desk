import type { WorldGateHost } from "@commentdesk/shared";
import type { Config } from "./config";
import type { WorldStore } from "./store";
import type { PortalVerifier } from "./world/portal";
import type { AgentPassOidc } from "./world/oidc";

export interface Deps {
  config: Config;
  store: WorldStore;
  host: WorldGateHost;
  portal: PortalVerifier;
  oidc: AgentPassOidc;
  /** Unix seconds; injectable so expiry paths are testable. */
  now: () => number;
}
