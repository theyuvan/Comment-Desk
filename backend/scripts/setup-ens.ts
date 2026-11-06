/**
 * One-time setup: buys the root name on Sepolia and deploys its registry and
 * the shared platform resolver. Safe to re-run: finished steps are skipped.
 * Costs Sepolia gas only. Rent is paid in the deployment's public MockUSDC.
 *
 *   npm run setup:ens
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  stringToHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  ROOT_SETUP_ROLES,
  RESOLVER_OWNER_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  ZERO_BYTES32,
  ethRegistrarAbi,
  ethRegistryAbi,
  factoryAbi,
  mockUsdcAbi,
  resolverAbi,
  userRegistryAbi,
} from "@commentdesk/contracts/ens";
import { dnsEncode, ownedResolverSalt, registrySalt } from "../src/ens/names.ts";

const key = process.env.ENS_OPERATOR_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Set ENS_OPERATOR_PRIVATE_KEY. npm run setup:wallets creates one.");
const label = process.env.ENS_ROOT_LABEL ?? "commentdesk";
const rootName = `${label}.eth`;
const account = privateKeyToAccount(key);
const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
const client = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ account, chain: sepolia, transport });

async function send(address: Address, abi: unknown, functionName: string, args: unknown[]) {
  const { request } = await client.simulateContract({ account, address, abi: abi as Abi, functionName, args });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  console.log(`  ${functionName}: https://sepolia.etherscan.io/tx/${hash}`);
}

const readRegistrar = <T>(functionName: string, args: unknown[] = []) =>
  client.readContract({ address: SEPOLIA.ethRegistrar, abi: ethRegistrarAbi as Abi, functionName, args }) as Promise<T>;
const predict = (salt: bigint) =>
  client.readContract({
    address: SEPOLIA.verifiableFactory,
    abi: factoryAbi as Abi,
    functionName: "predictProxyAddress",
    args: [account.address, salt],
  }) as Promise<Address>;

async function main() {
  const balance = await client.getBalance({ address: account.address });
  console.log(`Operator ${account.address} holds ${formatEther(balance)} Sepolia ETH`);
  if (balance === 0n) throw new Error("Fund the operator with Sepolia ETH first.");

  const registry = await predict(registrySalt(rootName));
  const resolver = await predict(ownedResolverSalt(account.address));

  const available = await readRegistrar<boolean>("isAvailable", [label]);
  if (available) {
    console.log(`Registering ${rootName}`);
    const minDuration = await readRegistrar<bigint>("MIN_REGISTER_DURATION");
    const minAge = await readRegistrar<bigint>("MIN_COMMITMENT_AGE");
    const duration = minDuration > 31_536_000n ? minDuration : 31_536_000n;
    const price = await readRegistrar<unknown>("getRegisterPrice", [label, duration, SEPOLIA.mockUsdc]);
    const parts = typeof price === "bigint" ? [price] : Object.values(price as Record<string, bigint>);
    const rent = parts.reduce((sum, part) => sum + part, 0n);

    await send(SEPOLIA.mockUsdc, mockUsdcAbi, "mint", [account.address, rent * 2n]);
    await send(SEPOLIA.mockUsdc, mockUsdcAbi, "approve", [SEPOLIA.ethRegistrar, rent * 2n]);

    // The secret is derived so a crash between commit and register can be resumed.
    const secret = keccak256(stringToHex(`${key}:${label}`));
    const commitment = await readRegistrar<Hex>("makeCommitment", [
      label, account.address, secret, registry, resolver, duration, ZERO_BYTES32,
    ]);
    if ((await readRegistrar<bigint>("commitmentAt", [commitment])) === 0n) {
      await send(SEPOLIA.ethRegistrar, ethRegistrarAbi, "commit", [commitment]);
    }
    const wait = Number(minAge) + 15;
    console.log(`  waiting ${wait}s for the commitment to age`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    await send(SEPOLIA.ethRegistrar, ethRegistrarAbi, "register", [
      label, account.address, secret, registry, resolver, duration, SEPOLIA.mockUsdc, ZERO_BYTES32,
    ]);
  } else {
    const owner = (await client.readContract({
      address: SEPOLIA.ethRegistry,
      abi: ethRegistryAbi as Abi,
      functionName: "findOwner",
      args: [label],
    })) as Address;
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`${rootName} belongs to ${owner}. Set ENS_ROOT_LABEL to a free label.`);
    }
    console.log(`${rootName} is already ours`);
  }

  if (!(await client.getCode({ address: registry }))) {
    console.log("Deploying the root UserRegistry");
    await send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl,
      registrySalt(rootName),
      encodeFunctionData({
        abi: userRegistryAbi as Abi,
        functionName: "initialize",
        args: [[{ account: account.address, roleBitmap: ROOT_SETUP_ROLES }]],
      }),
    ]);
  }

  if (!(await client.getCode({ address: resolver }))) {
    console.log("Deploying the platform resolver");
    await send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl,
      ownedResolverSalt(account.address),
      encodeFunctionData({
        abi: resolverAbi as Abi,
        functionName: "initialize",
        args: [[{ account: account.address, roleBitmap: RESOLVER_OWNER_ROLES }], []],
      }),
    ]);
  }

  // The back pointer. ENS uses it to verify the registry chain and find canonical names.
  const [parent] = (await client.readContract({
    address: registry,
    abi: userRegistryAbi as Abi,
    functionName: "getParent",
  })) as [Address, string];
  if (parent === zeroAddress) {
    console.log("Linking the registry to its parent");
    await send(registry, userRegistryAbi, "setParent", [SEPOLIA.ethRegistry, label]);
  }

  const description = "Verifiable public input. One real human per voice, and a record anyone can recount.";
  const current = await client.getEnsText({
    name: rootName,
    key: TEXT_KEYS.title,
    universalResolverAddress: SEPOLIA.universalResolver,
  }).catch(() => null);
  if (current !== description) {
    console.log("Setting the root name's records");
    await send(resolver, resolverAbi, "setText", [dnsEncode(rootName), TEXT_KEYS.title, description]);
  }

  console.log(`\nDone. ${rootName}`);
  console.log(`  registry ${registry}`);
  console.log(`  resolver ${resolver}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
