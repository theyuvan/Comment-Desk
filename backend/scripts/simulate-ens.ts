/**
 * Runs the whole ENSv2 naming flow against real Sepolia state with eth_simulateV1.
 * Needs no key and no funds, and nothing is broadcast. It proves the calldata,
 * roles and ordering against the live contracts before any gas is spent.
 *
 *   npx tsx scripts/simulate-ens.ts
 */
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import {
  ADMIN_SET_TEXT,
  COIN_TYPE_ETH,
  MEMBER_TOKEN_ROLES,
  OPERATOR_DOCKET_KEYS,
  OPERATOR_REGISTRY_ROLES,
  RESOLVER_OWNER_ROLES,
  RESOLVER_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  ZERO_BYTES32,
  ethRegistrarAbi,
  ethRegistryAbi,
  factoryAbi,
  mockUsdcAbi,
  resolverAbi,
  userRegistryAbi,
} from "../src/ens/constants.ts";
import { docketResolverSalt, dnsEncode, labelhash, platformResolverSalt, registrySalt } from "../src/ens/names.ts";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ROOT_LABEL = process.env.ENS_ROOT_LABEL ?? "commentdesk";
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const operator: Address = "0x1000000000000000000000000000000000000001";
const creator: Address = "0x2000000000000000000000000000000000000002";
const moderator: Address = "0x3000000000000000000000000000000000000003";
const stranger: Address = "0x4000000000000000000000000000000000000004";

const rootName = `${ROOT_LABEL}.eth`;
const memberName = `maya.${rootName}`;
const docketName = `truck-rule.${memberName}`;
const commentName = `comment-1.${docketName}`;

const call = (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[]) => ({
  from,
  to,
  data: encodeFunctionData({ abi: abi as Abi, functionName, args }),
  label: functionName,
});

const initRegistry = (grants: { account: Address; roleBitmap: bigint }[]) =>
  encodeFunctionData({ abi: userRegistryAbi as Abi, functionName: "initialize", args: [grants] });
const initResolver = (grants: { account: Address; roleBitmap: bigint }[], calls: Hex[] = []) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "initialize", args: [grants, calls] });

const predict = async (deployer: Address, salt: bigint) =>
  (await client.readContract({
    address: SEPOLIA.verifiableFactory,
    abi: factoryAbi as Abi,
    functionName: "predictProxyAddress",
    args: [deployer, salt],
  })) as Address;

async function main() {
  const available = await client.readContract({
    address: SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi as Abi,
    functionName: "isAvailable",
    args: [ROOT_LABEL],
  });
  console.log(`${rootName} available on Sepolia: ${available}`);
  if (!available) {
    console.log("Set ENS_ROOT_LABEL to a free label to run the simulation.");
    process.exit(1);
  }

  const read = (functionName: string) =>
    client.readContract({ address: SEPOLIA.ethRegistrar, abi: ethRegistrarAbi as Abi, functionName }) as Promise<bigint>;
  const [minAge, minDuration] = [await read("MIN_COMMITMENT_AGE"), await read("MIN_REGISTER_DURATION")];
  const duration = minDuration > 31_536_000n ? minDuration : 31_536_000n;

  const rootRegistry = await predict(operator, registrySalt(rootName));
  const platformResolver = await predict(operator, platformResolverSalt(operator));
  const memberRegistry = await predict(operator, registrySalt(memberName));
  const docketResolver = await predict(operator, docketResolverSalt(creator, docketName));

  const price = (await client.readContract({
    address: SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi as Abi,
    functionName: "getRegisterPrice",
    args: [ROOT_LABEL, duration, SEPOLIA.mockUsdc],
  })) as unknown;
  const total = Array.isArray(price)
    ? (price as bigint[]).reduce((sum, part) => sum + part, 0n)
    : typeof price === "object" && price
      ? Object.values(price as Record<string, bigint>).reduce((sum, part) => sum + part, 0n)
      : (price as bigint);
  console.log(`rent for ${duration}s: ${total} (MockUSDC units), min commitment age ${minAge}s`);

  const secret = keccak256(stringToHex("simulation"));
  const commitment = (await client.readContract({
    address: SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi as Abi,
    functionName: "makeCommitment",
    args: [ROOT_LABEL, operator, secret, rootRegistry, platformResolver, duration, ZERO_BYTES32],
  })) as Hex;

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 31_536_000);
  const statusSetter = encodeFunctionData({
    abi: resolverAbi as Abi,
    functionName: "setText",
    args: ["0x", TEXT_KEYS.status, ""],
  });
  const keySetters = OPERATOR_DOCKET_KEYS.map((key) =>
    encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: ["0x", key, ""] }),
  );

  const block1 = [
    call(operator, SEPOLIA.mockUsdc, mockUsdcAbi, "mint", [operator, total * 2n]),
    call(operator, SEPOLIA.mockUsdc, mockUsdcAbi, "approve", [SEPOLIA.ethRegistrar, total * 2n]),
    call(operator, SEPOLIA.ethRegistrar, ethRegistrarAbi, "commit", [commitment]),
  ];

  const docketInitCalls = [
    encodeFunctionData({
      abi: resolverAbi as Abi,
      functionName: "setText",
      args: [dnsEncode(docketName), TEXT_KEYS.status, "open"],
    }),
    encodeFunctionData({
      abi: resolverAbi as Abi,
      functionName: "setText",
      args: [dnsEncode(docketName), TEXT_KEYS.title, "Truck emissions rule"],
    }),
  ];

  const block2 = [
    call(operator, SEPOLIA.ethRegistrar, ethRegistrarAbi, "register", [
      ROOT_LABEL, operator, secret, rootRegistry, platformResolver, duration, SEPOLIA.mockUsdc, ZERO_BYTES32,
    ]),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl,
      registrySalt(rootName),
      initRegistry([{ account: operator, roleBitmap: OPERATOR_REGISTRY_ROLES }]),
    ]),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl,
      platformResolverSalt(operator),
      initResolver([{ account: operator, roleBitmap: RESOLVER_OWNER_ROLES }]),
    ]),
    call(operator, rootRegistry, userRegistryAbi, "register", [
      "maya", creator, "0x0000000000000000000000000000000000000000", platformResolver, MEMBER_TOKEN_ROLES, expiry,
    ]),
    call(operator, platformResolver, resolverAbi, "setAddress", [dnsEncode(memberName), COIN_TYPE_ETH, creator]),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl,
      registrySalt(memberName),
      initRegistry([{ account: operator, roleBitmap: OPERATOR_REGISTRY_ROLES }]),
    ]),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl,
      docketResolverSalt(creator, docketName),
      initResolver(
        [
          { account: creator, roleBitmap: RESOLVER_OWNER_ROLES },
          { account: operator, roleBitmap: ADMIN_SET_TEXT },
        ],
        docketInitCalls,
      ),
    ]),
    call(operator, rootRegistry, userRegistryAbi, "setSubregistry", [labelhash("maya"), memberRegistry]),
    call(operator, docketResolver, resolverAbi, "multicall", [
      [
        ...keySetters.map((setter) =>
          encodeFunctionData({ abi: resolverAbi as Abi, functionName: "grantSetterRoles", args: [setter, operator] }),
        ),
        encodeFunctionData({ abi: resolverAbi as Abi, functionName: "grantSetterRoles", args: [statusSetter, moderator] }),
        encodeFunctionData({ abi: resolverAbi as Abi, functionName: "revokeRootRoles", args: [ADMIN_SET_TEXT, operator] }),
      ],
    ]),
    call(operator, memberRegistry, userRegistryAbi, "register", [
      "truck-rule", creator, "0x0000000000000000000000000000000000000000", docketResolver, MEMBER_TOKEN_ROLES, expiry,
    ]),
    call(operator, memberRegistry, userRegistryAbi, "register", [
      "agent", creator, "0x0000000000000000000000000000000000000000", platformResolver, 0n, expiry,
    ]),
    call(operator, platformResolver, resolverAbi, "multicall", [
      [encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setAddress", args: [dnsEncode(`agent.${memberName}`), COIN_TYPE_ETH, creator] })],
    ]),
    call(operator, docketResolver, resolverAbi, "multicall", [
      [
        [TEXT_KEYS.arkivKey, `0x${"ab".repeat(32)}`],
        [TEXT_KEYS.author, memberName],
        [TEXT_KEYS.authorType, "human"],
        [TEXT_KEYS.topic, "emissions"],
      ].map(([key, value]) =>
        encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(commentName), key, value] }),
      ),
    ]),
    call(operator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.swarm, "ab".repeat(32)]),
    call(operator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, "closed"]),
    call(moderator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, "closed-for-cause"]),
  ];

  const denied = [
    { ...call(moderator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.title, "hijacked"]), label: "moderator edits title" },
    { ...call(stranger, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, "open"]), label: "stranger edits status" },
    { ...call(operator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.title, "hijacked"]), label: "operator edits title" },
    { ...call(operator, docketResolver, resolverAbi, "grantRootRoles", [RESOLVER_ROLES.SET_TEXT, operator]), label: "operator escalates to all text" },
    { ...call(operator, docketResolver, resolverAbi, "grantSetterRoles", [encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: ["0x", TEXT_KEYS.title, ""] }), operator]), label: "operator grants itself title" },
  ];

  const latest = await client.getBlock({ blockTag: "latest" });
  const nameResolve = (name: string, functionName: string, args: unknown[]) => ({
    to: SEPOLIA.universalResolver,
    from: stranger,
    label: `resolve ${functionName} ${name}`,
    data: encodeFunctionData({
      abi: parseAbi(["function resolve(bytes name, bytes data) view returns (bytes, address)"]),
      functionName: "resolve",
      args: [
        dnsEncode(name),
        encodeFunctionData({
          abi: parseAbi([
            "function addr(bytes32 node) view returns (address)",
            "function text(bytes32 node, string key) view returns (string)",
          ]),
          functionName: functionName as "text",
          args: [namehash(name), ...args] as never,
        }),
      ],
    }),
  });
  const block3 = [
    nameResolve(memberName, "addr", []),
    nameResolve(`agent.${memberName}`, "addr", []),
    nameResolve(commentName, "text", [TEXT_KEYS.author]),
    nameResolve(docketName, "text", [TEXT_KEYS.status]),
  ];

  const stateCalls = (calls: { from: Address; to: Address; data: Hex }[]) =>
    calls.map(({ from, to, data }) => ({ from, to, data, gas: "0x1c9c380" }));
  const hex = (value: bigint) => `0x${value.toString(16)}`;

  const blocks = [
    { calls: block1 },
    { calls: block2, blockOverrides: { time: hex(latest.timestamp + minAge + 60n) } },
    { calls: denied, blockOverrides: { time: hex(latest.timestamp + minAge + 72n) } },
    { calls: block3, blockOverrides: { time: hex(latest.timestamp + minAge + 84n) } },
  ];

  const result = (await client.request({
    method: "eth_simulateV1" as never,
    params: [
      {
        blockStateCalls: blocks.map((block) => ({
          ...("blockOverrides" in block ? { blockOverrides: block.blockOverrides } : {}),
          stateOverrides: Object.fromEntries(
            [operator, creator, moderator, stranger].map((account) => [account, { balance: "0xde0b6b3a7640000" }]),
          ),
          calls: stateCalls(block.calls),
        })),
        validation: false,
      },
      "latest",
    ] as never,
  })) as { calls: { status: string; returnData: Hex; gasUsed: string; error?: { message: string; data?: Hex } }[] }[];

  let failed = 0;
  let totalGas = 0n;
  result.forEach((simulated, blockIndex) => {
    simulated.calls.forEach((outcome, callIndex) => {
      const ok = outcome.status === "0x1";
      const shouldFail = blockIndex === 2;
      const label = blocks[blockIndex]!.calls[callIndex]!.label;
      const pass = ok !== shouldFail;
      if (!pass) failed++;
      totalGas += BigInt(outcome.gasUsed);
      console.log(
        `${pass ? "PASS" : "FAIL"} ${shouldFail ? "denied " : ""}${label} (gas ${BigInt(outcome.gasUsed)})${
          !ok && !shouldFail ? ` ${outcome.error?.message ?? ""} ${outcome.error?.data ?? outcome.returnData}` : ""
        }`,
      );
      if (blockIndex === 3 && ok) {
        const [encoded] = decodeFunctionResult({
          abi: parseAbi(["function resolve(bytes name, bytes data) view returns (bytes, address)"]),
          functionName: "resolve",
          data: outcome.returnData,
        });
        console.log(`  -> ${encoded}`);
      }
    });
  });
  console.log(failed === 0 ? `\nAll steps passed on real Sepolia state. Gas: ${totalGas}` : `\n${failed} step(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
