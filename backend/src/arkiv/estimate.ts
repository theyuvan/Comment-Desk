import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { custom, http, MethodNotFoundRpcError, type LocalAccount } from "viem";

/**
 * Unsigned gas estimate for one exact SDK write, per Arkiv's write-safety recipe.
 * Rabdi estimates can run low, so the writer doubles this. The wallet here cannot
 * sign, and any mutating RPC is refused. Errors never carry provider detail,
 * because the RPC URL contains the access key.
 */
const READS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_estimateGas",
]);

export type UnsignedWallet = ReturnType<typeof createWalletClient>;

export async function estimateWrite(
  account: LocalAccount,
  accessKey: string,
  prepare: (wallet: UnsignedWallet) => Promise<unknown>,
): Promise<bigint> {
  const chain = rabdi({ accessKey });
  const rpc = http(undefined, {
    retryCount: 0,
    timeout: 10_000,
    fetchOptions: { cache: "no-store", redirect: "error" },
  })({ chain });

  let estimate: bigint | undefined;
  const captured = new Error("Unsigned estimate captured");

  const transport = custom(
    {
      async request(args: { method: string; params?: unknown[] }) {
        if (args.method === "eth_fillTransaction") {
          throw new MethodNotFoundRpcError(new Error("Use guarded estimate path"));
        }
        if (!READS.has(args.method)) throw new Error("Mutating RPC blocked");
        const result = await rpc.request(
          (args.method === "eth_estimateGas"
            ? { method: "eth_estimateGas", params: [args.params?.[0], "latest"] }
            : args) as Parameters<typeof rpc.request>[0],
        );
        if (args.method === "eth_estimateGas") {
          if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) throw new Error("Invalid estimate");
          estimate = BigInt(result);
          if (estimate <= 0n) throw new Error("Invalid estimate");
          throw captured;
        }
        return result;
      },
    },
    { retryCount: 0 },
  );

  const unsigned = {
    ...account,
    signTransaction: async () => {
      throw new Error("Signing blocked");
    },
  };
  const wallet = createWalletClient({ account: unsigned, chain, transport });

  try {
    await prepare(wallet as never);
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; cause && depth < 24; depth++) {
      if (cause === captured && estimate !== undefined) return estimate;
      cause = typeof cause === "object" ? (cause as { cause?: unknown }).cause : undefined;
    }
    throw new Error("Unsigned preparation/estimate failed");
  }
  throw new Error("Estimation was skipped");
}

export function publicClientFor(accessKey: string) {
  return createPublicClient({
    chain: rabdi({ accessKey }),
    cacheTime: 0,
    transport: http(undefined, {
      timeout: 15_000,
      retryCount: 1,
      fetchOptions: { cache: "no-store", redirect: "error" },
    }),
  });
}
