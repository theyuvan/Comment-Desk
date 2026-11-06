# Comment Desk backend

Node and TypeScript API over Arkiv and ENSv2. World ID plugs in through one interface: see [WORLD_INTEGRATION.md](WORLD_INTEGRATION.md).

## Run it

```bash
npm install
npm run setup:wallets      # creates keys in .env, prints public addresses only
```

Then do these by hand:

1. Put a free access key from <https://hub.arkiv.network/access-keys> in `.env` as `ARKIV_ACCESS_KEY`.
2. Fund the Arkiv publisher with test GLM at <https://hub.arkiv.network/faucet>.
3. Fund the ENS operator and moderator with Sepolia ETH. About 0.05 ETH covers setup and a demo.

```bash
npm run check              # shows what is ready, never prints a secret
npm run simulate:ens       # free dry run of the whole ENS flow on real Sepolia state
npm run setup:ens          # buys commentdesk.eth, deploys its registry and resolver
npm run smoke:arkiv        # real write and read test of all four entities
npm run dev                # API on http://localhost:8787
```

`WORLD_GATE=dev` in `.env` runs the API without World. Every record it writes has a `dev:` proof reference, and it refuses to start in production.

## Checks

| Command | What it proves | Needs |
| --- | --- | --- |
| `npm test` | Product rules and denial paths, using real wallet signatures | Nothing |
| `npm run simulate:ens` | Every ENS call, role and denial against live Sepolia contracts | Nothing |
| `npm run probe:arkiv` | Query syntax against live Rabdi | Nothing |
| `npm run smoke:arkiv` | Real Arkiv writes, reads, patch, expiry, public recount | Key and test GLM |

## How the pieces fit

| Concern | Decision | Why |
| --- | --- | --- |
| Arkiv signer | One publisher wallet signs all entities | `$owner` and `$creator` are real signing addresses, so a per-user hash cannot live there. People are identified by the `owner_hash` column. |
| Trust | Every read is scoped with `.createdBy(publisher)` | A schema tag can be copied by anyone. `$creator` cannot change. |
| Immutability | `comment`, `member` and `policy_acceptance` are readonly | A posted comment can never be edited. |
| Expiry | Comments use the docket's exact expiry block | FR7, enforced by the data layer. |
| Long-lived records | `member` and `policy_acceptance` use `ExpirationTime.max()` | Rabdi has no permanent option. The maximum is about 182 days, renewable by Lifetime Extension. |
| Auth | Each write is an EIP-712 signature from the member's wallet | No sessions to steal. Signatures expire after 10 minutes. |
| Privacy | Only `keccak256(signature)` is stored | A raw signature would reveal the wallet behind `owner_hash`. |
| Write safety | One queue, a durable journal, no automatic retries | An ambiguous send may have landed. Writes stop until it is reconciled. |

## ENS layout

```
commentdesk.eth                      UserRegistry, shared platform resolver
maya.commentdesk.eth                 token owned by the member
agent.maya.commentdesk.eth           the member's agent, a separate name
truck-rule.maya.commentdesk.eth      token owned by the member, its own PermissionedResolver
comment-1.truck-rule.maya...         records on that resolver, resolved by wildcard, no token
```

Comments are resolver records and not tokens. ENS recommends this for operator-managed subnames, and a token per comment would cost far more.

Access on a docket's resolver:

| Account | Can write |
| --- | --- |
| Creator | Every record |
| Operator | Only `status`, `commentdesk.arkiv`, `.author`, `.author-type`, `.topic`, `.swarm` |
| Moderator | Only `status` |

The operator gives up its text admin role in the same transaction that sets this up, so it cannot grant itself more later. The simulation proves all of this, including the failed escalation attempts.

The docket's ENS record also stores the Swarm reference. That pointer outlives the Arkiv docket entity, which expires after its grace period.

## API

All bodies are JSON. Timestamps and bigints are decimal strings. Errors look like `{ "error": "stable_code", "message": "Readable text." }`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/typed-data` | EIP-712 domain, types and hash rules to sign with |
| GET | `/api/stats` | Live totals from Arkiv |
| POST | `/api/members` | Join: `handle`, `issuedAt`, `signature`, `worldProof` |
| GET | `/api/members/by-wallet/:wallet` | Member profile, and whether they can open dockets |
| POST | `/api/policies/docket-creation` | The second, separate consent |
| GET | `/api/dockets?status=` | Browse dockets |
| POST | `/api/dockets` | Open a docket |
| POST | `/api/dockets/body-hash` | Compute `bodyHash` before signing |
| GET | `/api/dockets/:key` | One docket, with its `phase` |
| GET | `/api/dockets/:key/comments` | Public comments |
| POST | `/api/dockets/:key/submission-key` | The value a World proof is bound to |
| POST | `/api/dockets/:key/comments` | Submit a comment through either gate |
| GET | `/api/dockets/:key/tally` | Counts, including what was ignored and why |
| GET | `/api/dockets/:key/insights` | Aggregates only |
| POST | `/api/dockets/:key/close` | Creator publishes the ruling after the deadline |
| POST | `/api/dockets/:key/moderate` | Moderator closes early for cause |
| GET | `/api/dockets/:key/archive` | The file to upload to Swarm |
| POST | `/api/dockets/:key/archive` | Record the Swarm reference on Arkiv and ENS |
| GET | `/api/ens/failures` | Background ENS writes that failed twice |

## Recount without us

```bash
npm run recount -- <docketKey> <publisherAddress>
```

This talks straight to Arkiv and uses no Comment Desk server or key. It runs the same `src/recount.ts` as the live tally, so the two can only differ if their input data differs.

The rule: a member's earliest comment per topic counts. Later ones stay on record but are ignored, as are comments after the deadline.

## If a write gets stuck

`arkiv_write_uncertain` means Arkiv did not confirm a write and it may still have landed. Writes pause on purpose. Restart the server: it checks the journal against Arkiv and clears anything it can prove. If an entry remains, check that nonce on <https://rabdi.explorer.arkiv.network>, then start once with `ARKIV_ACK_UNRESOLVED=1` if it never landed.

Run one instance only. Comment numbering and the write queues assume a single process.
