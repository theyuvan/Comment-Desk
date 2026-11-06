import type { WorldGateHost } from "./shared";
import type { Config } from "./world/config";
import type { WorldStore } from "./store";
import type { PortalVerifier } from "./world/portal";
import type { AgentPassOidc } from "./world/oidc";
import type { AgentModel } from "./world/agent-interview";

export interface Deps {
  config: Config;
  store: WorldStore;
  host: WorldGateHost;
  portal: PortalVerifier;
  oidc: AgentPassOidc;
  /** Unix seconds; injectable so expiry paths are testable. */
  now: () => number;
  /** The built-in drafting agent's model. Unset: members bring their own agent. */
  agentModel?: AgentModel;
  /** Proves control of a member's wallet. Set by the Arkiv/ENS half. */
  signIn?: (input: { issuedAt: bigint; signature: `0x${string}` }) => Promise<{ memberRef: string; ensName: string }>;
}
