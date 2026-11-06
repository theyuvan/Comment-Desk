/**
 * Makes commentdesk.eth's registry emancipated, as the .eth registry is. After
 * this the operator can only register and renew: it can never change a member's
 * resolver or registry, and the registry can never be moved.
 *
 * THIS IS PERMANENT. It cannot be undone by anyone. Rehearsed by simulate:ens.
 *
 *   npm run emancipate:ens -- --yes
 */
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DANGEROUS_REGISTRY_ROLES, PARENT_ROLES, SEPOLIA, factoryAbi, userRegistryAbi } from "../src/ens/constants.ts";
import { registrySalt } from "../src/ens/names.ts";

const key = process.env.ENS_OPERATOR_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Set ENS_OPERATOR_PRIVATE_KEY in .env");
const account = privateKeyToAccount(key);
const rootName = `${process.env.ENS_ROOT_LABEL ?? "commentdesk"}.eth`;
const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
const client = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ account, chain: sepolia, transport });

const registry = (await client.readContract({
  address: SEPOLIA.verifiableFactory,
  abi: factoryAbi as Abi,
  functionName: "predictProxyAddress",
  args: [account.address, registrySalt(rootName)],
})) as Address;
const isEmancipated = () =>
  client.readContract({ address: registry, abi: userRegistryAbi as Abi, functionName: "isEmancipated" }) as Promise<boolean>;

console.log(`${rootName} registry ${registry}`);
if (await isEmancipated()) {
  console.log("Already emancipated.");
  process.exit(0);
}
if (!process.argv.includes("--yes")) {
  console.log("Not emancipated. This step is permanent, so re-run with --yes to do it.");
  process.exit(0);
}

const { request } = await client.simulateContract({
  account,
  address: registry,
  abi: userRegistryAbi as Abi,
  functionName: "revokeRootRoles",
  args: [DANGEROUS_REGISTRY_ROLES | PARENT_ROLES, account.address],
});
const hash = await wallet.writeContract(request);
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success") throw new Error(`Reverted: ${hash}`);
console.log(`https://sepolia.etherscan.io/tx/${hash}`);
console.log(`isEmancipated: ${await isEmancipated()}`);
process.exit(0);
