import type { WorldGateHost } from "@commentdesk/shared";
import type { Config } from "./world/config";
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
  /** Proves control of a member's wallet. Set by the Arkiv/ENS half. */
  signIn?: (input: { issuedAt: bigint; signature: `0x${string}` }) => Promise<{ memberRef: string; ensName: string }>;
}
