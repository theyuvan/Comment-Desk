/**
 * Runs the whole ENSv2 naming flow against real Sepolia state with eth_simulateV1.
 * Needs no key and no funds, and nothing is broadcast. It proves the calldata,
 * roles and ordering against the live contracts before any gas is spent.
 *
 * Uses a fresh root label each run, so it works after commentdesk.eth is registered.
 *
 *   npm run simulate:ens
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
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import {
  ADMIN_SET_TEXT,
  COIN_TYPE_ETH,
  CREATOR_DOCKET_KEYS,
  DANGEROUS_REGISTRY_ROLES,
  MEMBER_TOKEN_ROLES,
  OPERATOR_DOCKET_KEYS,
  OPERATOR_SUBNAME_ROLES,
  PARENT_ROLES,
  RESOLVER_OWNER_ROLES,
  RESOLVER_ROLES,
  ROOT_SETUP_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  ZERO_BYTES32,
  ethRegistrarAbi,
  factoryAbi,
  mockUsdcAbi,
  resolverAbi,
  universalHelperAbi,
  userRegistryAbi,
} from "../src/ens/constants.ts";
import { dnsEncode, docketResolverSalt, labelhash, ownedResolverSalt, registrySalt } from "../src/ens/names.ts";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const operator: Address = "0x1000000000000000000000000000000000000001";
const creator: Address = "0x2000000000000000000000000000000000000002";
const moderator: Address = "0x3000000000000000000000000000000000000003";
const stranger: Address = "0x4000000000000000000000000000000000000004";
const commenter: Address = "0x5000000000000000000000000000000000000005";

const ROOT_LABEL = process.env.ENS_SIM_LABEL ?? `cdsim${Date.now().toString(36)}`;
const rootName = `${ROOT_LABEL}.eth`;
const memberName = `maya.${rootName}`;
const agentName = `agent.${memberName}`;
const docketName = `truck-rule.${memberName}`;
const commentName = `comment-1.${docketName}`;

type Step = { from: Address; to: Address; data: Hex; label: string; decode?: (data: Hex) => string; expect?: string };

const call = (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[], label = functionName): Step => ({
  from,
  to,
  data: encodeFunctionData({ abi: abi as Abi, functionName, args }),
  label,
});
const setText = (name: string, key: string, value: string) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(name), key, value] });
const setAddress = (name: string, wallet: Address) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setAddress", args: [dnsEncode(name), COIN_TYPE_ETH, wallet] });
const textSetter = (key: string) => encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: ["0x", key, ""] });
const grant = (key: string, account: Address) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "grantSetterRoles", args: [textSetter(key), account] });
const initRegistry = (grants: { account: Address; roleBitmap: bigint }[]) =>
  encodeFunctionData({ abi: userRegistryAbi as Abi, functionName: "initialize", args: [grants] });
const initResolver = (grants: { account: Address; roleBitmap: bigint }[], calls: Hex[] = []) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "initialize", args: [grants, calls] });

const predict = (salt: bigint) =>
  client.readContract({
    address: SEPOLIA.verifiableFactory,
    abi: factoryAbi as Abi,
    functionName: "predictProxyAddress",
    args: [operator, salt],
  }) as Promise<Address>;

const resolveAbi = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes, address)"]);
const profileAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);
const resolveStep = (name: string, functionName: "addr" | "text", args: string[] = []): Step => ({
  from: stranger,
  to: SEPOLIA.universalResolver,
  label: `resolve ${functionName} ${name.replace(rootName, "root.eth")}`,
  data: encodeFunctionData({
    abi: resolveAbi,
    functionName: "resolve",
    args: [
      dnsEncode(name),
      encodeFunctionData({ abi: profileAbi, functionName: functionName as "text", args: [namehash(name), ...args] as never }),
    ],
  }),
});
const emancipated = (registry: Address, label: string): Step => ({
  ...call(stranger, registry, userRegistryAbi, "isEmancipated", [], label),
  decode: (data) =>
    String(decodeFunctionResult({ abi: parseAbi(["function isEmancipated() view returns (bool)"]), functionName: "isEmancipated", data })),
  expect: "true",
});
/** DNS-encoded bytes to dotted text. */
const fromDns = (hex: Hex) => {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const labels: string[] = [];
  for (let at = 0; at < bytes.length && bytes[at] !== 0; at += bytes[at]! + 1) {
    labels.push(bytes.subarray(at + 1, at + 1 + bytes[at]!).toString("utf8"));
  }
  return labels.join(".");
};
const canonical = (registry: Address, label: string, expected: string): Step => ({
  ...call(stranger, SEPOLIA.universalHelper, universalHelperAbi, "findCanonicalName", [registry], label),
  decode: (data) => fromDns(decodeFunctionResult({ abi: universalHelperAbi as Abi, functionName: "findCanonicalName", data }) as Hex),
  expect: expected,
});

async function main() {
  const readRegistrar = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: SEPOLIA.ethRegistrar, abi: ethRegistrarAbi as Abi, functionName, args }) as Promise<T>;

  if (!(await readRegistrar<boolean>("isAvailable", [ROOT_LABEL]))) {
    console.log(`${rootName} is taken. Set ENS_SIM_LABEL to a free label.`);
    process.exit(1);
  }
  const minAge = await readRegistrar<bigint>("MIN_COMMITMENT_AGE");
  const minDuration = await readRegistrar<bigint>("MIN_REGISTER_DURATION");
  const duration = minDuration > 31_536_000n ? minDuration : 31_536_000n;

  const rootRegistry = await predict(registrySalt(rootName));
  const platformResolver = await predict(ownedResolverSalt(operator));
  const memberResolver = await predict(ownedResolverSalt(creator));
  const memberRegistry = await predict(registrySalt(memberName));
  const docketResolver = await predict(docketResolverSalt(creator, docketName));
  const docketRegistry = await predict(registrySalt(docketName));

  const price = await readRegistrar<unknown>("getRegisterPrice", [ROOT_LABEL, duration, SEPOLIA.mockUsdc]);
  const parts = typeof price === "bigint" ? [price] : Object.values(price as Record<string, bigint>);
  const rent = parts.reduce((sum, part) => sum + part, 0n);

  const secret = keccak256(stringToHex("simulation"));
  const commitment = await readRegistrar<Hex>("makeCommitment", [
    ROOT_LABEL, operator, secret, rootRegistry, platformResolver, duration, ZERO_BYTES32,
  ]);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 31_536_000);

  const prepare = [
    call(operator, SEPOLIA.mockUsdc, mockUsdcAbi, "mint", [operator, rent * 2n]),
    call(operator, SEPOLIA.mockUsdc, mockUsdcAbi, "approve", [SEPOLIA.ethRegistrar, rent * 2n]),
    call(operator, SEPOLIA.ethRegistrar, ethRegistrarAbi, "commit", [commitment]),
  ];

  const build = [
    // scripts/setup-ens.ts
    call(operator, SEPOLIA.ethRegistrar, ethRegistrarAbi, "register", [
      ROOT_LABEL, operator, secret, rootRegistry, platformResolver, duration, SEPOLIA.mockUsdc, ZERO_BYTES32,
    ], "buy root name"),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl, registrySalt(rootName), initRegistry([{ account: operator, roleBitmap: ROOT_SETUP_ROLES }]),
    ], "deploy root registry"),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl, ownedResolverSalt(operator),
      initResolver([{ account: operator, roleBitmap: RESOLVER_OWNER_ROLES }]),
    ], "deploy platform resolver"),
    call(operator, rootRegistry, userRegistryAbi, "setParent", [SEPOLIA.ethRegistry, ROOT_LABEL], "root setParent"),

    // scripts/emancipate-ens.ts
    call(operator, rootRegistry, userRegistryAbi, "revokeRootRoles", [DANGEROUS_REGISTRY_ROLES | PARENT_ROLES, operator], "emancipate root"),

    // EnsNaming.registerMember
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl, ownedResolverSalt(creator),
      initResolver([{ account: creator, roleBitmap: RESOLVER_OWNER_ROLES }], [setAddress(memberName, creator), setAddress(agentName, creator)]),
    ], "deploy member resolver"),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl, registrySalt(memberName), initRegistry([{ account: operator, roleBitmap: OPERATOR_SUBNAME_ROLES }]),
    ], "deploy member registry"),
    call(operator, memberRegistry, userRegistryAbi, "setParent", [rootRegistry, "maya"], "member setParent"),
    call(operator, rootRegistry, userRegistryAbi, "register", [
      "maya", creator, memberRegistry, memberResolver, MEMBER_TOKEN_ROLES, expiry,
    ], "register member"),

    // EnsNaming.openDocket
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.userRegistryImpl, registrySalt(docketName), initRegistry([{ account: operator, roleBitmap: OPERATOR_SUBNAME_ROLES }]),
    ], "deploy docket registry"),
    call(operator, docketRegistry, userRegistryAbi, "setParent", [memberRegistry, "truck-rule"], "docket setParent"),
    call(operator, SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
      SEPOLIA.permissionedResolverImpl, docketResolverSalt(creator, docketName),
      // During initialize the caller is the factory, so it holds text admin for this one transaction.
      initResolver([{ account: SEPOLIA.verifiableFactory, roleBitmap: ADMIN_SET_TEXT }], [
        setText(docketName, TEXT_KEYS.status, "open"),
        setText(docketName, TEXT_KEYS.title, "Truck emissions rule"),
        setText(docketName, TEXT_KEYS.topics, "emissions,cost"),
        ...CREATOR_DOCKET_KEYS.map((key) => grant(key, creator)),
        ...OPERATOR_DOCKET_KEYS.map((key) => grant(key, operator)),
        grant(TEXT_KEYS.status, moderator),
        encodeFunctionData({ abi: resolverAbi as Abi, functionName: "revokeRootRoles", args: [ADMIN_SET_TEXT, SEPOLIA.verifiableFactory] }),
      ]),
    ], "deploy docket resolver with all EAC grants in one tx"),
    call(operator, memberRegistry, userRegistryAbi, "register", [
      "truck-rule", creator, docketRegistry, docketResolver, MEMBER_TOKEN_ROLES, expiry,
    ], "register docket"),

    // EnsNaming.ensureAgentName
    call(operator, memberRegistry, userRegistryAbi, "register", ["agent", creator, zeroAddress, memberResolver, 0n, expiry], "register agent"),

    // EnsNaming.writeComment, setDocketArchive, setDocketStatus
    call(operator, docketRegistry, userRegistryAbi, "register", ["comment-1", commenter, zeroAddress, docketResolver, 0n, expiry], "register comment, owned by its author"),
    call(operator, docketResolver, resolverAbi, "multicall", [[
      setText(commentName, TEXT_KEYS.arkivKey, `0x${"ab".repeat(32)}`),
      setText(commentName, TEXT_KEYS.author, memberName),
      setText(commentName, TEXT_KEYS.authorType, "human"),
      setText(commentName, TEXT_KEYS.topic, "emissions"),
    ]], "write comment records"),
    call(operator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.swarm, "ab".repeat(32)], "operator sets swarm"),
    call(moderator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, "closed-for-cause"], "moderator sets status"),
    call(creator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.title, "Edited by its creator"], "creator edits title"),
  ];

  const denied = [
    call(moderator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.title, "x"], "moderator edits title"),
    call(stranger, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, "x"], "stranger edits status"),
    call(operator, docketResolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.title, "x"], "operator edits title"),
    call(creator, docketResolver, resolverAbi, "setText", [dnsEncode(commentName), TEXT_KEYS.author, "x"], "creator rewrites a comment's author"),
    call(creator, docketResolver, resolverAbi, "setText", [dnsEncode(commentName), TEXT_KEYS.arkivKey, "x"], "creator repoints a comment"),
    call(creator, docketResolver, resolverAbi, "linkToRecord", [dnsEncode(commentName), 0n], "creator unlinks a comment"),
    call(operator, docketResolver, resolverAbi, "grantRootRoles", [RESOLVER_ROLES.SET_TEXT, operator], "operator escalates to all text"),
    call(creator, docketResolver, resolverAbi, "grantRootRoles", [RESOLVER_ROLES.SET_TEXT, creator], "creator escalates to all text"),
    call(operator, docketResolver, resolverAbi, "grantSetterRoles", [textSetter(TEXT_KEYS.title), operator], "operator grants itself title"),
    call(operator, memberResolver, resolverAbi, "setAddress", [dnsEncode(memberName), COIN_TYPE_ETH, stranger], "operator repoints a member's address"),
    call(operator, rootRegistry, userRegistryAbi, "setResolver", [labelhash("maya"), stranger], "operator replaces a member's resolver"),
    call(operator, rootRegistry, userRegistryAbi, "setSubregistry", [labelhash("maya"), stranger], "operator replaces a member's registry"),
    call(operator, rootRegistry, userRegistryAbi, "unregister", [labelhash("maya")], "operator deletes a member"),
    call(operator, memberRegistry, userRegistryAbi, "setResolver", [labelhash("truck-rule"), stranger], "operator replaces a docket's resolver"),
    call(operator, docketRegistry, userRegistryAbi, "unregister", [labelhash("comment-1")], "operator deletes a comment name"),
    call(operator, docketRegistry, userRegistryAbi, "setResolver", [labelhash("comment-1"), stranger], "operator redirects a comment name"),
    call(commenter, docketRegistry, userRegistryAbi, "setResolver", [labelhash("comment-1"), stranger], "author redirects their comment name"),
    call(operator, rootRegistry, userRegistryAbi, "setParent", [stranger, "x"], "operator remounts the root registry"),
    call(creator, rootRegistry, userRegistryAbi, "register", ["sybil", creator, zeroAddress, zeroAddress, 0n, expiry], "member mints a second name"),
    call(operator, rootRegistry, userRegistryAbi, "grantRootRoles", [DANGEROUS_REGISTRY_ROLES, operator], "operator regains root roles"),
  ];

  const memberTokenId = await (async () => {
    // Read inside the simulation: the name does not exist on chain.
    return encodeFunctionData({ abi: userRegistryAbi as Abi, functionName: "findTokenId", args: ["maya"] });
  })();

  const views: Step[] = [
    resolveStep(memberName, "addr"),
    resolveStep(agentName, "addr"),
    resolveStep(commentName, "text", [TEXT_KEYS.author]),
    resolveStep(docketName, "text", [TEXT_KEYS.status]),
    {
      ...call(stranger, docketResolver, resolverAbi, "hasAssignees", [0n, ADMIN_SET_TEXT], "nobody holds text admin on the docket resolver"),
      decode: (data) => String(BigInt(data) !== 0n),
      expect: "false",
    },
    emancipated(rootRegistry, "root registry is emancipated"),
    emancipated(memberRegistry, "member registry is emancipated"),
    emancipated(docketRegistry, "docket registry is emancipated"),
    canonical(docketRegistry, "canonical name of the docket registry", docketName),
    {
      ...call(stranger, docketRegistry, userRegistryAbi, "findOwner", ["comment-1"], "comment name is owned by its author"),
      decode: (data) => `0x${data.slice(-40)}`,
      expect: commenter,
    },
    canonical(rootRegistry, "canonical name of the root registry", rootName),
    canonical(memberRegistry, "canonical name of the member registry", memberName),
    { from: stranger, to: docketRegistry, data: encodeFunctionData({ abi: userRegistryAbi as Abi, functionName: "findTokenId", args: ["comment-1"] }), label: "read comment token id" },
    { from: stranger, to: rootRegistry, data: memberTokenId, label: "read member token id" },
  ];

  const latest = await client.getBlock({ blockTag: "latest" });
  const hex = (value: bigint) => `0x${value.toString(16)}`;
  type Block = { calls: Step[]; time?: bigint; deny?: boolean; view?: boolean };
  const blocks: Block[] = [
    { calls: prepare },
    { calls: build, time: latest.timestamp + minAge + 60n },
    { calls: denied, time: latest.timestamp + minAge + 72n, deny: true },
    { calls: views, time: latest.timestamp + minAge + 84n, view: true },
  ];

  const simulate = async (list: Block[]) =>
    (await client.request({
      method: "eth_simulateV1" as never,
      params: [
        {
          blockStateCalls: list.map((block) => ({
            ...(block.time ? { blockOverrides: { time: hex(block.time) } } : {}),
            stateOverrides: Object.fromEntries(
              [operator, creator, moderator, stranger].map((account) => [account, { balance: "0xde0b6b3a7640000" }]),
            ),
            calls: block.calls.map(({ from, to, data }) => ({ from, to, data, gas: "0x1c9c380" })),
          })),
          validation: false,
        },
        "latest",
      ] as never,
    })) as { calls: { status: string; returnData: Hex; gasUsed: string; error?: { message: string; data?: Hex } }[] }[];

  const first = await simulate(blocks);
  const tokenResult = first[3]?.calls.at(-1);
  const tokenId = tokenResult?.status === "0x1" ? BigInt(tokenResult.returnData) : 0n;
  const commentTokenResult = first[3]?.calls.at(-2);
  const commentTokenId = commentTokenResult?.status === "0x1" ? BigInt(commentTokenResult.returnData) : 0n;

  // The soulbound check needs the token ID, so it runs with the same state in a second pass.
  const transfers: Step[] = [
    call(creator, rootRegistry, userRegistryAbi, "unsafeTransfer", [stranger, tokenId, "0x"], "member sells their name (unsafeTransfer)"),
    call(creator, rootRegistry, userRegistryAbi, "safeTransferFrom", [creator, stranger, tokenId, 1n, "0x"], "member sells their name (safeTransferFrom)"),
    call(commenter, docketRegistry, userRegistryAbi, "unsafeTransfer", [stranger, commentTokenId, "0x"], "author sells their comment name"),
  ];
  blocks[3]!.calls = views.slice(0, -2);
  blocks.push({ calls: transfers, time: latest.timestamp + minAge + 96n, deny: true });

  const result = await simulate(blocks);
  let failed = 0;
  let passed = 0;
  result.forEach((simulated, blockIndex) => {
    const block = blocks[blockIndex]!;
    simulated.calls.forEach((outcome, callIndex) => {
      const step = block.calls[callIndex]!;
      const ok = outcome.status === "0x1";
      let detail = "";
      let pass = ok !== Boolean(block.deny);
      if (block.view && ok) {
        detail = step.decode?.(outcome.returnData) ?? "";
        if (step.expect) pass = detail === step.expect;
      }
      if (pass) passed++;
      else failed++;
      const error = !ok && !block.deny ? ` ${outcome.error?.message ?? ""} ${outcome.error?.data ?? outcome.returnData}` : "";
      console.log(`${pass ? "PASS" : "FAIL"} ${block.deny ? "denied: " : ""}${step.label}${detail ? ` -> ${detail}` : ""}${error}`);
    });
  });
  console.log(failed === 0 ? `\nAll ${passed} steps passed on real Sepolia state.` : `\n${failed} step(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
