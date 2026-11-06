import { z } from "zod";
import type { Address, Hex } from "viem";

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const schema = z.object({
  PORT: z.coerce.number().int().default(8787),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATA_DIR: z.string().default("data"),

  ARKIV_ACCESS_KEY: z.string().min(1),
  ARKIV_PRIVATE_KEY: privateKey,
  /** Most this backend will pay for one Arkiv write, in wei of testnet GLM. */
  ARKIV_MAX_FEE_WEI: z.coerce.bigint().default(10n ** 17n),
  ARKIV_ACK_UNRESOLVED: z.preprocess(emptyToUndefined, z.literal("1").optional()),

  SEPOLIA_RPC_URL: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),
  ENS_OPERATOR_PRIVATE_KEY: privateKey,
  ENS_MODERATOR_PRIVATE_KEY: z.preprocess(emptyToUndefined, privateKey.optional()),
  ENS_ROOT_LABEL: z.string().default("commentdesk"),

  /** The public gateway by default. Point this at your own Bee node for a stamp you control. */
  SWARM_BEE_URL: z.string().url().default("https://api.gateway.ethswarm.org"),
  SWARM_BATCH_ID: z.preprocess(emptyToUndefined, z.string().regex(/^[0-9a-f]{64}$/).optional()),

  /** Comma-separated wallets allowed to moderate. */
  MODERATOR_ADDRESSES: z.string().default(""),
  GRACE_DAYS: z.coerce.number().positive().default(7),
  MAX_COMMENTS_PER_TOPIC: z.coerce.number().int().positive().default(1),
  POLICY_VERSION: z.string().default("1"),

  /** Unset until the World gate lands. "dev" enables the clearly labelled stand-in. */
  WORLD_GATE: z.preprocess(emptyToUndefined, z.literal("dev").optional()),
  NODE_ENV: z.string().default("development"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Field names only: values here are secrets.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${fields}. See .env.example`);
  }
  const values = parsed.data;
  if (values.WORLD_GATE === "dev" && values.NODE_ENV === "production") {
    throw new Error("WORLD_GATE=dev is refused in production");
  }
  return {
    ...values,
    ARKIV_PRIVATE_KEY: values.ARKIV_PRIVATE_KEY as Hex,
    ENS_OPERATOR_PRIVATE_KEY: values.ENS_OPERATOR_PRIVATE_KEY as Hex,
    ENS_MODERATOR_PRIVATE_KEY: values.ENS_MODERATOR_PRIVATE_KEY as Hex | undefined,
    moderators: values.MODERATOR_ADDRESSES.split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean) as Address[],
    rootName: `${values.ENS_ROOT_LABEL}.eth`,
  };
}
