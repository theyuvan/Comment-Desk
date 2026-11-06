import { randomBytes } from "node:crypto";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { WorldRequestDto } from "../src/shared";
import { loadConfig } from "../src/world/config";
import type { Deps } from "../src/deps";
import { WorldStore } from "../src/store";
import { StubHost } from "../src/host/stub-host";
import type { PortalVerdict } from "../src/world/portal";
import type { AgentPassOidc, AuthorizeParams, StepUpClaims } from "../src/world/oidc";

export const ISSUER = "https://auth.world.org";
export const ORB = "https://world.org/oidc/acr/orb";

export function makeDeps() {
  // signRequest stamps the RP context with the real clock, so start from real time.
  let clock = Math.floor(Date.now() / 1000);
  const config = loadConfig({
    SESSION_SECRET: "x".repeat(32),
    WORLD_ID_APP_ID: "app_test",
    WORLD_ID_RP_ID: "rp_test",
    WORLD_ID_SIGNING_KEY: `0x${randomBytes(32).toString("hex")}`,
    AGENT_PASS_CLIENT_ID: "client",
    AGENT_PASS_CLIENT_SECRET: "secret",
    AGENT_PASS_REDIRECT_URI: "https://localhost:3000/api/agent-pass/callback",
    AGENT_PASS_CONFIRM_TTL_SECONDS: "120",
  });
  const host = StubHost.withDemoDockets(clock);
  const portal = { verdict: { success: true, environment: "production" } as PortalVerdict, calls: 0 };
  const idp = {
    lastAuthorize: null as AuthorizeParams | null,
    /** Override per test to simulate what World IdP asserts. */
    claims: (nonce: string): StepUpClaims => ({
      iss: ISSUER,
      sub: "world-sub-1",
      acr: ORB,
      auth_time: clock,
      jti: randomBytes(8).toString("hex"),
      nonce,
    }),
  };
  const oidc: AgentPassOidc = {
    issuer: () => ISSUER,
    async authorizationUrl(p) {
      idp.lastAuthorize = p;
      const url = new URL(`${ISSUER}/api/v1/authorize`);
      url.searchParams.set("state", p.state);
      return url;
    },
    async redeem(_url, checks) {
      return idp.claims(checks.nonce);
    },
  };
  const deps: Deps = {
    config,
    store: new WorldStore(null),
    host,
    portal: {
      async verify() {
        portal.calls++;
        return portal.verdict;
      },
    },
    oidc,
    now: () => clock,
  };
  return {
    deps,
    host,
    portal,
    idp,
    advance: (s: number) => {
      clock += s;
    },
    now: () => clock,
  };
}

/** What World App would return for a request, with a chosen nullifier. */
export function fakeIdkitResult(
  req: WorldRequestDto,
  opts: { nullifier?: string; signal?: string; identifier?: string; environment?: string } = {},
) {
  return {
    protocol_version: "4.0",
    nonce: req.rp_context.nonce,
    action: req.action,
    environment: opts.environment ?? req.environment,
    user_presence_completed: req.require_user_presence ? true : undefined,
    responses: [
      {
        identifier: opts.identifier ?? req.credential,
        signal_hash: hashSignal(opts.signal ?? req.signal),
        proof: ["1", "2", "3", "4", "5"],
        nullifier: opts.nullifier ?? "123456789",
        issuer_schema_id: req.credential === "selfie" ? 11 : 1,
        expires_at_min: 0,
      },
    ],
  };
}

export function callbackUrl(params: Record<string, string>) {
  const url = new URL("https://localhost:3000/api/agent-pass/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
