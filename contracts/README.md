# contracts/: the on-chain layer

`@commentdesk/contracts` holds everything Comment Desk knows about the chains it writes to. The
backend and the browser recount both import it, so there is one definition of each contract and
each entity.

| Folder | What it is |
| --- | --- |
| [ens/sepolia.ts](ens/sepolia.ts) and [ens/abi/](ens/abi/) | The official **ENSv2 deployment on Sepolia** that Comment Desk calls: addresses, verified ABIs, registry and resolver roles, and the text record keys we write |
| [arkiv/schemas.ts](arkiv/schemas.ts) | The four **Arkiv entities** on Rabdi (chain 7794095): member, policy acceptance, docket and comment |

```ts
import { SEPOLIA, userRegistryAbi, TEXT_KEYS } from "@commentdesk/contracts/ens";
import { CommentSchema, DocketSchema } from "@commentdesk/contracts/arkiv";
```

## Why there is no Solidity here

We don't deploy contracts of our own. Comment Desk uses **ENS's own ENSv2 contracts**, which are
already live on Sepolia, and **Arkiv**, which stores typed entities rather than running user
contracts. A custom registrar was left out on purpose: the operator wallet registers names, which
ENS allows, and an extra contract would add risk without changing what users can do. See "Out of
scope" in [left.md](../left.md).

## ENSv2: who controls what

| Name | Owner | Notes |
| --- | --- | --- |
| `commentdesk.eth` | Operator | Root. `npm run emancipate:ens -w backend -- --yes` removes the operator's override roles (permanent) |
| `maya.commentdesk.eth` | The member's passkey wallet | `ROLE_CAN_TRANSFER_ADMIN` is withheld, so a verified identity can't be sold. The operator holds only register and renew |
| `agent.maya.commentdesk.eth` | The member | The member's AI agent, as its own namespace |
| `truck-rule.maya.commentdesk.eth` | The creator | Has its own Permissioned Resolver. Access is split by record key: the creator sets the docket's facts, the operator sets comment and archive records, a moderator sets only `status`. Nobody holds text admin, so this can't be widened |
| `comment-1.truck-rule.…` | The comment's author | Records: author, author type, topic, and the Arkiv key |

Runtime code: [backend/src/ens/naming.ts](../backend/src/ens/naming.ts). Setup and checks:
`npm run setup:ens`, `npm run simulate:ens` and `npm run probe:ens` in `backend/`.

## Arkiv: what is public

| Entity | Readonly | Expires | Holds |
| --- | --- | --- | --- |
| `commentdesk_member_v1` | Yes | Max lifetime (about 182 days) | Owner hash, World join nullifier, ENS name, proof reference |
| `commentdesk_policy_acceptance_v1` | Yes | Max lifetime | Owner hash, policy, signature **hash** |
| `commentdesk_docket_v1` | No: status, ruling and Swarm reference change | One grace week after the deadline | Title, question, topics, credential level |
| `commentdesk_comment_v1` | Yes | With its docket | Topic, position, author type (human or agent), World proof reference, text |

No raw wallet address and no raw signature is ever written: people are identified only by a
domain-separated hash of their wallet. Every read is scoped to the publisher with `$creator`.
Runtime code: [backend/src/arkiv/store.ts](../backend/src/arkiv/store.ts). Full schema:
[arkiv/schema.md](../arkiv/schema.md).

The World gates never touch either chain directly. They hand verified results to `DeskWorldHost`,
which writes these entities and mints these names.
