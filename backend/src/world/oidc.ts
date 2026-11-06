import * as client from "openid-client";
import type { Config } from "../config";

/** Claims we act on from a validated World IdP ID token. */
export interface StepUpClaims {
  iss: string;
  sub: string;
  acr: string;
  amr?: string[];
  auth_time: number;
  jti?: string;
  nonce?: string;
}

export interface AuthorizeParams {
  state: string;
  nonce: string;
  codeChallenge: string;
  acrValues: string[];
  /** If the member already linked a World account, World must authenticate that same account. */
  requiredSub?: string;
}

export interface AgentPassOidc {
  issuer(): string;
  authorizationUrl(p: AuthorizeParams): Promise<URL>;
  /** Redeems the code once; validates signature, iss, aud, exp, nonce, state and PKCE. */
  redeem(callbackUrl: URL, checks: { state: string; nonce: string; pkceVerifier: string }): Promise<StepUpClaims>;
}

export function createWorldIdpClient(config: Config): AgentPassOidc {
  let configuration: Promise<client.Configuration> | null = null;
  const discover = () => {
    configuration ??= client
      .discovery(
        new URL(config.AGENT_PASS_ISSUER),
        config.AGENT_PASS_CLIENT_ID,
        undefined,
        config.AGENT_PASS_CLIENT_AUTH === "client_secret_post"
          ? client.ClientSecretPost(config.AGENT_PASS_CLIENT_SECRET)
          : client.ClientSecretBasic(config.AGENT_PASS_CLIENT_SECRET),
      )
      .catch((err) => {
        configuration = null;
        throw err;
      });
    return configuration;
  };

  return {
    issuer: () => config.AGENT_PASS_ISSUER,

    async authorizationUrl(p) {
      const idTokenClaims: Record<string, unknown> = {
        acr: { essential: true, values: p.acrValues },
      };
      if (p.requiredSub) idTokenClaims.sub = { value: p.requiredSub };
      return client.buildAuthorizationUrl(await discover(), {
        redirect_uri: config.AGENT_PASS_REDIRECT_URI,
        scope: "openid",
        state: p.state,
        nonce: p.nonce,
        code_challenge: p.codeChallenge,
        code_challenge_method: "S256",
        // Fresh authentication for this attempt — an existing World IdP session doesn't count.
        max_age: "0",
        prompt: "login",
        claims: JSON.stringify({ id_token: idTokenClaims }),
      });
    },

    async redeem(callbackUrl, checks) {
      const tokens = await client.authorizationCodeGrant(await discover(), callbackUrl, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.pkceVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("No ID token returned");
      return {
        iss: claims.iss,
        sub: claims.sub,
        acr: String(claims.acr ?? ""),
        amr: claims.amr as string[] | undefined,
        auth_time: Number(claims.auth_time),
        jti: claims.jti as string | undefined,
        nonce: claims.nonce as string | undefined,
      };
    },
  };
}
