import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().url().default("https://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  DATA_FILE: z.string().default("data/world-gate.json"),

  // IDKit 4 — Developer Portal (developer.world.org) app + RP.
  WORLD_ID_APP_ID: z.string().regex(/^app_/, "WORLD_ID_APP_ID must start with app_"),
  WORLD_ID_RP_ID: z.string().regex(/^rp_/, "WORLD_ID_RP_ID must start with rp_"),
  WORLD_ID_SIGNING_KEY: z.string().min(1),
  WORLD_ID_ENVIRONMENT: z.enum(["production", "staging"]).default("production"),
  WORLD_ID_JOIN_CREDENTIAL: z.enum(["proof_of_human", "selfie"]).default("proof_of_human"),
  WORLD_ID_ALLOW_LEGACY_PROOFS: bool,
  WORLD_ID_REQUEST_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  WORLD_ID_PORTAL_BASE: z.string().url().default("https://developer.world.org"),

  // World ID Agent Pass — World IdP (auth.world.org) OIDC client.
  AGENT_PASS_ISSUER: z.string().url().default("https://auth.world.org"),
  AGENT_PASS_CLIENT_ID: z.string().min(1),
  AGENT_PASS_CLIENT_SECRET: z.string().min(1),
  AGENT_PASS_CLIENT_AUTH: z.enum(["client_secret_basic", "client_secret_post"]).default("client_secret_basic"),
  AGENT_PASS_REDIRECT_URI: z.string().url(),
  AGENT_PASS_ACR_VALUES: z
    .string()
    .default("https://world.org/oidc/acr/orb")
    .transform((v) => v.split(/[\s,]+/).filter(Boolean)),
  AGENT_PASS_CONFIRM_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  AGENT_DRAFT_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // Built-in drafting agent. Needs GEMINI_API_KEY, or ANTHROPIC_API_KEY as an alternative; without it, members use their own agent.
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  AGENT_INTERVIEW_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid backend configuration (see backend/.env.example):\n${lines.join("\n")}`);
  }
  return parsed.data;
}
