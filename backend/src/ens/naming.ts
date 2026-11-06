import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { sepolia } from "viem/chains";
import { activity, STEP } from "../activity.ts";
import { AppError, SerialQueue } from "../core.ts";
import {
  ADMIN_SET_TEXT,
  COIN_TYPE_ETH,
  CREATOR_DOCKET_KEYS,
  MEMBER_TOKEN_ROLES,
  OPERATOR_DOCKET_KEYS,
  OPERATOR_SUBNAME_ROLES,
  RESOLVER_OWNER_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  factoryAbi,
  resolverAbi,
  userRegistryAbi,
} from "@commentdesk/contracts/ens";
import { dnsEncode, docketResolverSalt, ownedResolverSalt, registrySalt } from "./names.ts";

export type DocketRecords = {
  title: string;
  deadline: bigint;
  topics: string[];
  credentialLevel: string;
};

/** The live rules of a docket, as its ENS records state them right now. */
export type DocketRules = { status: string | null; credential: string | null; agents: string | null };

/** What any wallet sees for a name: where it resolves, its resolver, and Comment Desk's records. */
export type NameInfo = { name: string; address: Address | null; resolver: Address | null; records: Record<string, string> };

/** Services depend on this, so they can be tested without a network. */
export interface Naming {
  readonly rootName: string;
  registerMember(label: string, wallet: Address): Promise<string>;
  /** Whether a name exists on ENS yet. */
  hasName(name: string): Promise<boolean>;
  openDocket(input: { memberName: string; label: string; wallet: Address; records: DocketRecords }): Promise<string>;
  linkDocket(docketName: string, arkivKey: Hex): Promise<void>;
  writeComment(input: {
    docketName: string;
    commentName: string;
    authorEns: string;
    authorType: string;
    topic: string;
    arkivKey: Hex;
    wallet: Address;
  }): Promise<void>;
  ensureAgentName(memberName: string, wallet: Address): Promise<string>;
  walletOf(memberName: string): Promise<Address>;
  docketRules(docketName: string): Promise<DocketRules>;
  nameInfo(name: string): Promise<NameInfo>;
  setDocketStatus(docketName: string, status: string, by: "operator" | "moderator"): Promise<void>;
  setDocketArchive(docketName: string, swarmRef: string): Promise<void>;
}

const ONE_YEAR = 31_536_000n;
const ENS_UNREADABLE = () => new AppError(503, "ens_unavailable", "ENS can't be read right now, so nothing was posted.");
const parentOf = (name: string) => name.slice(name.indexOf(".") + 1);
const labelOf = (name: string) => name.slice(0, name.indexOf("."));
const setText = (name: string, key: string, value: string) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(name), key, value] });
const setAddress = (name: string, wallet: Address) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setAddress", args: [dnsEncode(name), COIN_TYPE_ETH, wallet] });
const textSetter = (key: string) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: ["0x", key, ""] });

/**
 * Every call sequence here is exercised against real Sepolia state by
 * scripts/simulate-ens.ts. Change them together.
 *
 *   commentdesk.eth          UserRegistry, shared platform resolver
 *   maya.commentdesk.eth     non-transferable token, the member's own resolver and registry
 *   rule.maya.commentdesk... token owned by the member, its own PermissionedResolver
 *   comment-1.rule.maya...   non-transferable token owned by its author, records on the docket's resolver
 *
 * Member and docket registries are emancipated from birth: the operator can only register
 * and renew, so it can never change or delete a name once it exists.
 */
export class EnsNaming implements Naming {
  readonly rootName: string;
  readonly client;
  private readonly wallet;
  private readonly queue = new SerialQueue();

  constructor(
    private readonly options: {
      rpcUrl: string;
      rootName: string;
      operator: PrivateKeyAccount;
      moderator?: PrivateKeyAccount;
      moderators: Address[];
    },
  ) {
    this.rootName = options.rootName;
    // Public RPCs drop requests now and then, so reads retry before anything fails.
    const transport = http(options.rpcUrl, { retryCount: 5, retryDelay: 800, timeout: 30_000 });
    this.client = createPublicClient({ chain: sepolia, transport });
    this.wallet = createWalletClient({ chain: sepolia, transport });
  }

  private get operator() {
    return this.options.operator;
  }

  private predict(salt: bigint) {
    return this.client.readContract({
      address: SEPOLIA.verifiableFactory,
      abi: factoryAbi as Abi,
      functionName: "predictProxyAddress",
      args: [this.operator.address, salt],
    }) as Promise<Address>;
  }

  private registryOf(name: string) {
    return this.predict(registrySalt(name));
  }

  private async isDeployed(address: Address) {
    return Boolean(await this.client.getCode({ address }));
  }

  /**
   * A load-balanced RPC can answer from a node a block behind, where a contract we just
   * deployed has no code yet. A call to it then simulates fine and estimates ~23k gas, and
   * the real transaction runs out of gas. Wait until the code is visible first.
   */
  private async awaitCode(address: Address) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await this.isDeployed(address)) return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new AppError(502, "ens_not_deployed", `No contract at ${address} yet. Nothing was sent.`);
  }

  private async send(
    label: string,
    address: Address,
    abi: unknown,
    functionName: string,
    args: unknown[],
    account: PrivateKeyAccount = this.operator,
  ): Promise<Hex> {
    await this.awaitCode(address);
    let request;
    let gas: bigint;
    try {
      ({ request } = await this.client.simulateContract({ account, address, abi: abi as Abi, functionName, args }));
      gas = await this.client.estimateContractGas({ account, address, abi: abi as Abi, functionName, args });
    } catch {
      throw new AppError(502, "ens_rejected", `ENS rejected ${functionName}. Nothing was sent.`);
    }
    // Headroom, and a floor a stale "no code here" estimate can't slip under. Unused gas is refunded.
    const limit = gas * 13n / 10n > 120_000n ? gas * 13n / 10n : 120_000n;
    const hash = await this.wallet.writeContract({ ...request, gas: limit });
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      activity.note({ label, chain: "sepolia", tx: hash, status: "failed" });
      throw new AppError(502, "ens_reverted", `ENS ${functionName} reverted: ${hash}`);
    }
    activity.note({ label, chain: "sepolia", tx: hash });
    return hash;
  }

  private ownerOf(registry: Address, label: string) {
    return this.client.readContract({
      address: registry,
      abi: userRegistryAbi as Abi,
      functionName: "findOwner",
      args: [label],
    }) as Promise<Address>;
  }

  private expiry() {
    return BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR;
  }

  /**
   * Everything a member's name needs exists before the name does, so the
   * operator never needs a role that could touch it afterwards. Each step is
   * skipped if already done, which makes a failed join safe to retry.
   */
  registerMember(label: string, wallet: Address): Promise<string> {
    return this.queue.run(async () => {
      const name = `${label}.${this.rootName}`;
      const root = await this.registryOf(this.rootName);
      const owner = await this.ownerOf(root, label);
      if (owner !== zeroAddress) {
        if (owner.toLowerCase() === wallet.toLowerCase()) return name;
        throw new AppError(409, "handle_taken", `${name} is already taken.`);
      }

      // The member's own resolver. They hold every role and the operator holds none.
      const resolverSalt = ownedResolverSalt(wallet);
      const resolver = await this.predict(resolverSalt);
      if (!(await this.isDeployed(resolver))) {
        const init = encodeFunctionData({
          abi: resolverAbi as Abi,
          functionName: "initialize",
          args: [
            [{ account: wallet, roleBitmap: RESOLVER_OWNER_ROLES }],
            [setAddress(name, wallet), setAddress(`agent.${name}`, wallet)],
          ],
        });
        await this.send(STEP.resolver(name), SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
          SEPOLIA.permissionedResolverImpl, resolverSalt, init,
        ]);
      }

      const registry = await this.deployRegistry(name, root);

      await this.send(STEP.registered(name), root, userRegistryAbi, "register", [
        label, wallet, registry, resolver, MEMBER_TOKEN_ROLES, this.expiry(),
      ]);
      return name;
    });
  }

  /**
   * A registry for `name`, linked back to its parent. Not emancipated: the
   * operator keeps `SET_PARENT` on it (see `OPERATOR_SUBNAME_ROLES`), so it can
   * still be re-parented after this call. Nobody's actual name token inside it
   * is affected by that — `MEMBER_TOKEN_ROLES` governs those independently.
   */
  private async deployRegistry(name: string, parent: Address): Promise<Address> {
    const registry = await this.registryOf(name);
    if (!(await this.isDeployed(registry))) {
      const init = encodeFunctionData({
        abi: userRegistryAbi as Abi,
        functionName: "initialize",
        args: [[{ account: this.operator.address, roleBitmap: OPERATOR_SUBNAME_ROLES }]],
      });
      await this.send(STEP.registry(name), SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
        SEPOLIA.userRegistryImpl, registrySalt(name), init,
      ]);
    }
    await this.send(STEP.linked(name), registry, userRegistryAbi, "setParent", [parent, labelOf(name)]);
    return registry;
  }

  openDocket(input: { memberName: string; label: string; wallet: Address; records: DocketRecords }): Promise<string> {
    return this.queue.run(async () => {
      const { memberName, label, wallet, records } = input;
      const name = `${label}.${memberName}`;
      const registry = await this.registryOf(memberName);
      if ((await this.ownerOf(registry, label)) !== zeroAddress) {
        throw new AppError(409, "docket_taken", `${name} already exists.`);
      }

      // Comments are real names under the docket, so the ENS app and any wallet can see them.
      const commentRegistry = await this.deployRegistry(name, registry);

      // Enhanced Access Control, set once in the deployment. During `initialize`
      // the caller is the factory, so it holds text admin for this one transaction
      // and gives it up at the end. Nobody holds it afterwards, so these grants
      // can never be widened by the creator, the operator or a moderator.
      const salt = docketResolverSalt(wallet, name);
      const resolver = await this.predict(salt);
      const grant = (key: string, account: Address) =>
        encodeFunctionData({
          abi: resolverAbi as Abi,
          functionName: "grantSetterRoles",
          args: [textSetter(key), account],
        });
      const init = encodeFunctionData({
        abi: resolverAbi as Abi,
        functionName: "initialize",
        args: [
          [{ account: SEPOLIA.verifiableFactory, roleBitmap: ADMIN_SET_TEXT }],
          [
            setText(name, TEXT_KEYS.status, "open"),
            setText(name, TEXT_KEYS.title, records.title),
            setText(name, TEXT_KEYS.deadline, new Date(Number(records.deadline)).toISOString()),
            setText(name, TEXT_KEYS.topics, records.topics.join(",")),
            setText(name, TEXT_KEYS.credential, records.credentialLevel),
            setText(name, TEXT_KEYS.agents, "allowed"),
            ...CREATOR_DOCKET_KEYS.map((key) => grant(key, wallet)),
            ...OPERATOR_DOCKET_KEYS.map((key) => grant(key, this.operator.address)),
            ...[...new Set(this.moderatorAddresses())].map((moderator) => grant(TEXT_KEYS.status, moderator)),
            encodeFunctionData({
              abi: resolverAbi as Abi,
              functionName: "revokeRootRoles",
              args: [ADMIN_SET_TEXT, SEPOLIA.verifiableFactory],
            }),
          ],
        ],
      });
      if (!(await this.isDeployed(resolver))) {
        await this.send(STEP.docketResolver(name), SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
          SEPOLIA.permissionedResolverImpl, salt, init,
        ]);
      }

      await this.send(STEP.registered(name), registry, userRegistryAbi, "register", [
        label, wallet, commentRegistry, resolver, MEMBER_TOKEN_ROLES, this.expiry(),
      ]);
      return name;
    });
  }

  private moderatorAddresses(): Address[] {
    const { moderator, moderators } = this.options;
    return [...moderators, ...(moderator ? [moderator.address.toLowerCase() as Address] : [])];
  }

  private async docketResolver(docketName: string): Promise<Address> {
    const registry = await this.registryOf(parentOf(docketName));
    return (await this.client.readContract({
      address: registry,
      abi: userRegistryAbi as Abi,
      functionName: "getResolver",
      args: [labelOf(docketName)],
    })) as Address;
  }

  linkDocket(docketName: string, arkivKey: Hex): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(docketName);
      await this.send(STEP.arkivLink(docketName), resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.arkivKey, arkivKey]);
    });
  }

  writeComment(input: {
    docketName: string;
    commentName: string;
    authorEns: string;
    authorType: string;
    topic: string;
    arkivKey: Hex;
    wallet: Address;
  }): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(input.docketName);
      const registry = await this.registryOf(input.docketName);
      const label = labelOf(input.commentName);
      // Owned by its author, with no roles: it cannot be transferred, changed or deleted.
      if ((await this.ownerOf(registry, label)) === zeroAddress) {
        await this.send(STEP.registered(input.commentName), registry, userRegistryAbi, "register", [
          label, input.wallet, zeroAddress, resolver, 0n, this.expiry(),
        ]);
      }
      await this.send(STEP.records(input.commentName), resolver, resolverAbi, "multicall", [
        [
          setText(input.commentName, TEXT_KEYS.arkivKey, input.arkivKey),
          setText(input.commentName, TEXT_KEYS.author, input.authorEns),
          setText(input.commentName, TEXT_KEYS.authorType, input.authorType),
          setText(input.commentName, TEXT_KEYS.topic, input.topic),
        ],
      ]);
    });
  }

  /** Read through the Universal Resolver, so it shows exactly what a wallet or the ENS app would. */
  async nameInfo(name: string): Promise<NameInfo> {
    const universalResolverAddress = SEPOLIA.universalResolver;
    const [address, resolver] = await Promise.all([
      this.client.getEnsAddress({ name, universalResolverAddress }).catch(() => null),
      this.client.getEnsResolver({ name, universalResolverAddress }).catch(() => null),
    ]);
    const records: Record<string, string> = {};
    await Promise.all(
      Object.values(TEXT_KEYS).map(async (key) => {
        const value = await this.client.getEnsText({ name, key, universalResolverAddress }).catch(() => null);
        if (value) records[key] = value;
      }),
    );
    return { name, address: address ?? null, resolver: resolver ?? null, records };
  }

  /** Whether a name is registered yet, read straight from its parent's registry. */
  async hasName(name: string): Promise<boolean> {
    const registry = await this.registryOf(parentOf(name));
    if (!(await this.isDeployed(registry))) return false;
    return (await this.ownerOf(registry, labelOf(name))) !== zeroAddress;
  }

  /** Arkiv never holds a raw wallet, and ENS already publishes this one. */
  async walletOf(memberName: string): Promise<Address> {
    const wallet = await this.client
      .getEnsAddress({ name: memberName, universalResolverAddress: SEPOLIA.universalResolver })
      .catch(() => {
        throw ENS_UNREADABLE();
      });
    if (!wallet) throw new AppError(403, "ens_unresolved", `${memberName} no longer resolves, so it can't comment.`);
    return wallet;
  }

  /** Read through the Universal Resolver, the way any wallet or app would see them. */
  async docketRules(docketName: string): Promise<DocketRules> {
    const read = (key: string) =>
      this.client.getEnsText({ name: docketName, key, universalResolverAddress: SEPOLIA.universalResolver });
    try {
      const [status, credential, agents] = await Promise.all([
        read(TEXT_KEYS.status),
        read(TEXT_KEYS.credential),
        read(TEXT_KEYS.agents),
      ]);
      return { status, credential, agents };
    } catch {
      throw ENS_UNREADABLE();
    }
  }

  /** agent.maya.commentdesk.eth: human and agent authorship as two resolvable names. */
  ensureAgentName(memberName: string, wallet: Address): Promise<string> {
    return this.queue.run(async () => {
      const name = `agent.${memberName}`;
      const registry = await this.registryOf(memberName);
      if ((await this.ownerOf(registry, "agent")) === zeroAddress) {
        // The member's resolver already holds this name's record, written when they joined.
        const resolver = (await this.client.readContract({
          address: await this.registryOf(this.rootName),
          abi: userRegistryAbi as Abi,
          functionName: "getResolver",
          args: [labelOf(memberName)],
        })) as Address;
        await this.send(STEP.registered(name), registry, userRegistryAbi, "register", [
          "agent", wallet, zeroAddress, resolver, 0n, this.expiry(),
        ]);
      }
      return name;
    });
  }

  setDocketStatus(docketName: string, status: string, by: "operator" | "moderator"): Promise<void> {
    return this.queue.run(async () => {
      const account = by === "moderator" ? this.options.moderator : this.operator;
      if (!account) throw new AppError(503, "moderator_key_missing", "No moderator key is configured.");
      const resolver = await this.docketResolver(docketName);
      await this.send(STEP.status(docketName, status), resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, status], account);
    });
  }

  setDocketArchive(docketName: string, swarmRef: string): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(docketName);
      await this.send(STEP.swarmPointer(docketName), resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.swarm, swarmRef]);
    });
  }
}
