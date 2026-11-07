<p align="center">
  <img src="frontend/public/brand/commentdesk-logo-512.png" alt="Comment Desk logo" width="96" height="96" />
</p>

<h1 align="center">Comment Desk</h1>

<p align="center">
  <strong>Proof, not promises.</strong><br />
  A public-comment platform where every post is tied to one real, unique human — never a script, never a wallet alone —<br />
  given a real ENS name, and recorded somewhere nobody's backend controls.
</p>

<p align="center">
  <img alt="World ID" src="https://img.shields.io/badge/World%20ID-IDKit%204%20%2B%20Agent%20Pass-000000?labelColor=1a1a1a" />
  <img alt="Arkiv" src="https://img.shields.io/badge/Arkiv-Rabdi%20testnet-000000?labelColor=1a1a1a" />
  <img alt="ENS" src="https://img.shields.io/badge/ENS-ENSv2%20on%20Sepolia-000000?labelColor=1a1a1a" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-128%20passing-2ea043?labelColor=1a1a1a" />
  <img alt="Stack" src="https://img.shields.io/badge/stack-Next.js%20%2B%20Hono%2FExpress-000000?labelColor=1a1a1a" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-000000?labelColor=1a1a1a" />
</p>

```bash
git clone https://github.com/theyuvan/CommentDesk.git
cd CommentDesk && npm install
```

Built for **ETHGlobal Mumbai, Nov 2026**. Three sponsor tracks, each one load-bearing in the actual product, not bolted on for points: **World ID** (identity + Agent Pass), **Arkiv** (the record layer), **ENS** (the naming layer). See [Quickstart](#quickstart-about-5-minutes) to run it, or [Proof it works](#proof-it-works-real-addresses-real-transactions) to check it without running anything.

---

**The one-line pitch**: it feels like Reddit or X — people post under dockets, reply, see counts go up — but every post is tied to one real, unique human, and a docket isn't a feed that scrolls away. A docket is a case: it opens, collects input against a deadline, **concludes** with a published ruling, and the full record of who-said-what stays queryable forever (or until its stated expiry), by anyone, independent of the platform. Reddit has no deadline, no conclusion, no Sybil resistance, and no record you can recount yourself. That gap is the entire product.

## Contents

- [The problem](#the-problem)
- [The flow](#the-flow)
- [Track checklist](#track-checklist-what-each-sponsor-asked-for-quoted)
- [Why each track is load-bearing, not cosmetic](#why-each-track-is-load-bearing-not-cosmetic)
- [What it demonstrates](#what-it-demonstrates)
- [Proof it works](#proof-it-works-real-addresses-real-transactions)
- [Tech stack](#tech-stack)
- [Quickstart](#quickstart-about-5-minutes)
- [Documentation map](#documentation-map)
- [Identity and naming model](#identity-and-naming-model)
- [Access control](#access-control)
- [Arkiv entity schema](#arkiv-entity-schema)
- [Requirements (SRS)](#requirements-srs)
- [Modules](#modules)
- [Implementation details — real calls, no mocked proofs](#implementation-details--real-calls-no-mocked-proofs)
- [Required judging deliverables (Arkiv track)](#required-judging-deliverables-arkiv-track-verbatim-requirements)
- [Project layout](#project-layout)
- [Deployed addresses](#deployed-addresses)
- [Security and honest gaps](#security-and-honest-gaps)
- [How we used AI](#how-we-used-ai)
- [License](#license)

## The problem

AI makes fake public input free to produce at scale, and the platforms collecting that input mostly can't tell a real person from a script.

| Incident | What happened |
| --- | --- |
| CiviClick | 20,000 AI-written comments sent to a Southern California air board using **real residents' identities, without their consent**. The board voted 7–5 afterward. |
| Washington State | ~37,000 fake AI comments, the same names reused 50–100 times a night. |
| FCC, 2017 net neutrality | ~18 million fake comments out of 22 million total. |
| **The gap, every time** | **0** of those portals checked for a human. Only "did a submission arrive," never "is a real, unique person behind it, right now." |

Web3 communities carry the same weakness in a different shape: a DAO vote is only as trustworthy as "one wallet, one voice," which isn't the same as one human.

| Without Comment Desk | With Comment Desk |
| --- | --- |
| A submission just has to arrive — no check for a real, unique human | World ID verifies one real human before anything posts |
| An anonymous wallet address, or nothing at all | A readable ENS name — `maya.commentdesk.eth`, not `0x71C7…` |
| The tally lives in the platform's own database — you trust the operator's word | The tally lives on Arkiv — anyone re-derives it independently, with no API key |
| An agent can post on your behalf with no fresh check | An agent can draft, but posting needs a live, fresh Agent Pass approval bound to that exact text |
| A feed that scrolls away — no deadline, no conclusion | A docket: opens, collects input against a deadline, **concludes** with a published ruling |
| Comment text and the published ruling live only on the platform's server | On close, the ruling + full archive move to Swarm as the permanent case file |

## The flow

```text
JOIN     →  Verify once with World ID (Proof of Human or Selfie Check) → mint an ENS name
OPEN     →  A member signs the docket-creation policy → opens a docket (topics, deadline, credential level)
COMMENT  →  Human types it themselves (IDKit check) — or an agent drafts it (Agent Pass gate at submit)
RECORD   →  Written to Arkiv, owner hashed, readonly, expires with its docket — ENS decides who's allowed
RECOUNT  →  Anyone re-derives the tally straight from Arkiv — no account, no trust in this platform's server
CLOSE    →  Deadline hits → ruling published → full case file archived to Swarm → the record outlives the entity
```

Two comment paths exist because risk isn't uniform — matching the check's strength to how decoupled the content is from direct human judgment, not applying the heaviest check everywhere (theater) or the lightest everywhere (the exact hole CiviClick exploited):

- **A human typed it themselves** → a standard IDKit check is enough. The act of writing it was already the human's own review.
- **An agent drafted it** → the full Agent Pass gate: a fresh, action-scoped confirm at the exact moment of submission, bound to the draft's hash, because authorship and human review were decoupled the moment the agent wrote it instead of the person.

## Track checklist — what each sponsor asked for, quoted

Every row quotes ETHGlobal's own published requirement for Mumbai (`ethglobal.com/events/mumbai/prizes`) where the page gave exact wording; the right column points at a real file or line in this repo, never a generic claim.

### World ID — Agent Pass ($5,000 general + $2,500 Continuity) and Best Use of IDKit ($2,500 ×2)

| Requirement (sponsor's wording) | Satisfied by |
| --- | --- |
| "Integrate with the official World ID Agent Pass." | Real OIDC step-up against `auth.world.org` — [backend/src/world/agent-pass.ts](backend/src/world/agent-pass.ts) |
| "Demonstrate the complete journey: identity or verification request, user completion, validated result, and the protected application or agent action." | Agent drafts → member approves via Agent Pass → comment posts. Full script: [world/world-id.md](world/world-id.md) |
| "Demonstrate a denied, expired, cancelled, or otherwise unsuccessful path." | Draft-changed, cancelled, expired paths all discard the draft — [world/agent-pass.md](world/agent-pass.md#successful-and-alternative-paths-demonstrated) |
| "Validate identity results in a secure backend; do not expose client secrets or treat an unvalidated client response as authorization." | Every check (PKCE, state, nonce, `acr`, `auth_time`, draft-hash match) runs server-side — [backend/src/world/agent-pass.ts:81](backend/src/world/agent-pass.ts#L81) |
| "Integrate IDKit in a functioning application, mini app, or onchain flow." | [frontend/world/WorldVerifyButton.tsx](frontend/world/WorldVerifyButton.tsx) + [backend/src/world/idkit.ts](backend/src/world/idkit.ts) |
| "Use at least one supported World ID credential and verify the result on the server." | Proof of Human (join) and Selfie Check (soft dockets), verified against `developer.world.org`, never trusted from the client |
| "Clearly explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance." | [world/idkit.md § How we use it](world/idkit.md#how-we-use-it) |
| "Include a short integration debrief/feedback: time to first success, friction, missing capability, one improvement." | [world/agent-pass.md § Integration debrief](world/agent-pass.md#integration-debrief), [world/idkit.md § Integration debrief](world/idkit.md#integration-debrief) |

### Arkiv — Build on Arkiv (up to $4,000) + Swarm bonus ($500)

| Requirement | Satisfied by |
| --- | --- |
| Writes to Arkiv's current testnet (Rabdi) via `@arkiv-network/sdk`, with at least one user-facing feature reading it back | Live tally + public recount page both read straight from Arkiv, not a cache |
| README lists the writing wallet address and a runnable query | See [Required judging deliverables](#required-judging-deliverables-arkiv-track-verbatim-requirements) |
| Judged 25% each across four files: Arkiv feedback / Reach / Why Arkiv / How you use Arkiv | [arkiv/friction.md](arkiv/friction.md) · [arkiv/reach.md](arkiv/reach.md) · [arkiv/why-arkiv.md](arkiv/why-arkiv.md) · [arkiv/how-you-use-arkiv.md](arkiv/how-you-use-arkiv.md) |
| Swarm bonus: used together, not separately | Closed docket's ruling + comment archive moves to Swarm; reference written back onto the `docket` entity — [arkiv/swarm.md](arkiv/swarm.md) |
| Public repo, open-source license, AI-usage disclosed | [LICENSE](LICENSE) (MIT), [How we used AI](#how-we-used-ai) |

### ENS — Best Use of ENSv2 (up to $7,000)

| Requirement | Satisfied by |
| --- | --- |
| Built on ENSv2, mainnet or Sepolia accepted | Sepolia, real ENSv2 contracts — [Deployed addresses](#deployed-addresses) |
| ENSv2 central to the product, not cosmetic | Every comment reads the docket's live ENS text records *before* Arkiv is touched — [ens/key-features.md § Why it's central](ens/key-features.md#why-its-central-not-cosmetic) |
| Functional demo, no hard-coded values | `npm run simulate:ens -w backend` replays the whole flow, denied paths included, against live contracts |
| Open-source code | [github.com/theyuvan/CommentDesk](https://github.com/theyuvan/CommentDesk) |

## Why each track is load-bearing, not cosmetic

**World ID.** The product's entire trust claim — "one human, one counted comment" — is worthless without a way to tell a real, unique human from a script, and without collecting PII in the process. Everything else here (ENS names, Arkiv records, recounts) is built *on top of* a World ID proof, not alongside it.

**Arkiv.** The pitch is "recount it yourself, don't trust our server." That claim is only true if the tally actually lives somewhere nobody's backend controls. Swapping Arkiv for Postgres would make every count in this product a claim again, not a fact — see [arkiv/why-arkiv.md](arkiv/why-arkiv.md).

**ENS.** Not a vanity name — an access-control decision point. If a moderator writes `closed-for-cause` to one ENS text record, the next comment is refused, even if Arkiv's own copy of the docket still says open. Pull ENS out and the product's core promise — that not even this platform's own server can keep a closed case open — stops being true.

## What it demonstrates

| Capability | How it's built |
| --- | --- |
| **One human, one voice** | World ID verification is required once at join; the nullifier makes a second identity for the same human impossible, not just discouraged |
| **Every name is real** | ENSv2 decides who can comment, not just this server — a moderator's ENS write can close a docket even if the database still says open |
| **Agents draft, humans approve** | An agent can read a docket and propose a comment, but posting needs a fresh, draft-bound Agent Pass confirm — changed words need a new approval |
| **Recount it yourself** | The tally lives on Arkiv, not in a private database — anyone re-derives it with no account and no trust in this server |
| **A case, not a feed** | A docket has a deadline and a published ruling; on close, the full record moves to Swarm as the permanent case file |

## Proof it works — real addresses, real transactions

Every row below is something you can re-verify yourself, not a screenshot.

| Proof | Where |
| --- | --- |
| Live, filterable feed of every World/Arkiv/ENS action this app has taken, each step linked to its real tx or Arkiv entity | `/activity` in the running app — see [Quickstart](#quickstart-about-5-minutes) |
| `commentdesk.eth` root registry emancipated — the operator's `SET_RESOLVER`/`SET_SUBREGISTRY` rights on it are gone, re-run and verified live | [tx `0xaaa8af7287…8d35b5b`](https://sepolia.etherscan.io/tx/0xaaa8af72870c4e6cded1d39289d1365f025151e415f190f28f22adf008d35b5b) |
| A real Arkiv `docket` entity, holding its Swarm archive reference after close | `0x37655b1db9c5de5156a2700e4e7eb0ff5407a6edef70258c45d386855f2d7e14` — [arkiv/swarm.md](arkiv/swarm.md) |
| Every entity this app has ever written to Arkiv, independently re-queryable | `0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310` — runnable query in [Required judging deliverables](#required-judging-deliverables-arkiv-track-verbatim-requirements) |
| Every deployed contract/wallet used in the demo | [Deployed addresses](#deployed-addresses) |

## Tech stack

| Layer | Choice |
| --- | --- |
| Identity | `@worldcoin/idkit` 4.6 (human path), World ID Agent Pass / OIDC step-up (agent path) — production World App, not the track's mocked-proof allowance |
| Naming | ENSv2 on Sepolia — `UserRegistry` proxies, a Permissioned Resolver per docket, Enhanced Access Control for the Moderator role |
| Data | `@arkiv-network/sdk` 1.0.1 on Rabdi (chain `7794095`) — typed schemas, `createEntity`, `ExpirationTime`, `.createdBy()` queries |
| Archive | Swarm via the Bee HTTP API — closed docket's permanent ruling + comment archive |
| Backend | Node/TypeScript, Hono + Express, `tsx` |
| Frontend | Next.js 16, React 19, Tailwind, Radix UI |
| Monorepo | npm workspaces — `frontend`, `backend`, `contracts` |
| Tests | 128 passing — `vitest` + `node --test`, run with `npm test -w backend` |

## Quickstart (about 5 minutes)

**Prerequisites**: Node.js 22+, a World ID app from [developer.world.org](https://developer.world.org), an Arkiv access key from [hub.arkiv.network/access-keys](https://hub.arkiv.network/access-keys), and some Sepolia ETH for the ENS operator wallet.

```bash
git clone https://github.com/theyuvan/CommentDesk.git
cd CommentDesk && npm install
```

```bash
cp backend/.env.example backend/.env    # fill in: SESSION_SECRET (openssl rand -hex 32),
                                         # WORLD_ID_*, ARKIV_*, ENS_* — see backend/.env.example
cp frontend/.env.example frontend/.env.local
```

```bash
npm run dev:backend     # http://localhost:8787  (World gates on :4000)
npm run dev:frontend    # https://localhost:3000  (self-signed HTTPS — needed for World ID/passkeys)
```

Open `https://localhost:3000/join` to verify with World ID and mint an ENS name, `/dockets/new` to open a docket, and `/activity` to watch every World/Arkiv/ENS action land as a real transaction.

```bash
npm run typecheck   # contracts + backend + frontend
npm test -w backend # 128 tests
```

## Documentation map

| File | What it covers |
| --- | --- |
| [arkiv/schema.md](arkiv/schema.md) | The four Arkiv entities, their queryable fields, owners, expirations |
| [arkiv/friction.md](arkiv/friction.md) | What got in the way building on Arkiv, and what would've helped |
| [arkiv/reach.md](arkiv/reach.md) | Who this is for, and whether it keeps being built after Mumbai |
| [arkiv/why-arkiv.md](arkiv/why-arkiv.md) | What's lost if Arkiv were swapped for Postgres |
| [arkiv/how-you-use-arkiv.md](arkiv/how-you-use-arkiv.md) | Confirms every Arkiv feature used changes something a user actually sees |
| [arkiv/swarm.md](arkiv/swarm.md) | What's on Swarm vs. Arkiv, a real entity key + Swarm reference, reproducible upload/read |
| [ens/key-features.md](ens/key-features.md) | ENSv2 primitives in use, why they're central, the root-emancipation proof |
| [world/world-id.md](world/world-id.md) | The full demo script, every denied/alternative path, setup traps |
| [world/agent-pass.md](world/agent-pass.md) | Agent Pass track debrief: how it's used, alternative paths, integration debrief |
| [world/idkit.md](world/idkit.md) | IDKit track debrief: credential choice reasoning, alternative paths, integration debrief |

## Identity and naming model

**World ID** establishes that one real, unique human exists behind an identity — the Sybil-resistance layer. **ENS** makes that identity, and everything it creates, a human-readable, resolvable name instead of a hidden wallet hash:

```
maya.commentdesk.eth                                ← Maya's identity, minted on join
truck-emissions-rule.maya.commentdesk.eth            ← a docket Maya opened
agent.maya.commentdesk.eth                           ← Maya's agent, a separate name
comment-1.truck-emissions-rule.maya.commentdesk.eth  ← one comment under it
```

Clicking through that chain in the demo is the whole pitch made visible: a person, their docket, their comment — each a real name you can resolve, not a row in someone's table.

**Why ENSv2, not legacy ENS**: every comment gets its own resolvable name — potentially thousands per docket. In ENSv2 each name level has its own registry, so members, dockets and comments are real names, and each comment is owned by the person who wrote it.

Three ENSv2 primitives earn their place beyond plain subname minting:
- **Enhanced Access Control**: a Moderator is granted the right to edit *only* a docket's `status` field, not full ownership of the name.
- **Permissioned Resolver per docket**: write access split by record key, granted once at deployment, never widened afterward.
- **Permissioned Registry for members**: member names withhold `ROLE_CAN_TRANSFER_ADMIN`, so a verified identity can never be sold.

**Do we need a wallet?** Yes — but only as the cryptographic key behind ENS ownership and the hashed Arkiv owner field, never for payment. A member's wallet is their passkey (Face ID, fingerprint, Windows Hello) via the WebAuthn PRF extension — no seed phrase, no key saved anywhere, and the backend sends and pays for every transaction.

## Access control

| Role | Can do | Gained by |
| --- | --- | --- |
| Visitor | Read dockets, read the public recount | Nothing — open by default |
| Member | Comment, run analyst queries | World ID verify + ENS mint + join policy signature |
| Creator | Open a docket, publish its closing response | Member + docket-creation policy signature |
| Moderator | Flag or close a docket early for policy violations | Platform-level grant, not self-service |

Per-docket credential level (set by the Creator) adds a second axis: a "serious" docket can require Proof of Human for every comment, while a casual one accepts the lighter, explicitly-labeled "soft" Selfie Check.

## Arkiv entity schema

| Entity | Owner | Key fields | Expiry |
| --- | --- | --- | --- |
| `member` | Hash of wallet | ENS name, World ID nullifier reference, join-policy entity ref | Maximum lifetime (~182 days), renewable |
| `policy_acceptance` | Hash of wallet | which policy, signature hash, timestamp | Maximum lifetime (~182 days), renewable |
| `docket` | Hash of creator's wallet | title, topics, deadline, credential level | Deadline + grace period |
| `comment` | Hash of commenter's wallet | docket ref, topic, stance text, author type, proof ref | Docket's expiry |

`$owner`/`$creator` are always the real signing wallet; people are identified by an `owner_hash` column so a passive observer can't casually deanonymize a commenter without already knowing their wallet. Rabdi has no permanent entities — the longest lifetime is 7,884,000 blocks, so long-lived records need a Lifetime Extension.

## Requirements (SRS)

### Functional

| ID | Requirement |
| --- | --- |
| FR1 | A verified human can mint exactly one ENS identity on this platform. |
| FR2 | A separate policy signature is required at join, and again at docket creation. |
| FR3 | Docket creation requires the docket-creation policy signature. |
| FR4 | At most one *counted* comment per member per topic per docket. |
| FR5 | A human-authored comment requires an IDKit verification at submission. |
| FR6 | An agent-authored comment requires a fresh Agent Pass confirm, scoped to the exact draft text. |
| FR7 | Comment records expire at docket close plus a grace period. |
| FR8 | A recount function reads directly from Arkiv, independent of this platform's own backend. |
| FR9 | An aggregate insight query returns counts/sentiment per topic without resolving to a raw identity. |
| FR10 | Every entity's owner field is a hash of the underlying wallet address, never the raw address. |

### Non-functional

| ID | Requirement |
| --- | --- |
| NFR1 | **Privacy** — no entity stores a name, physical address, or other PII. |
| NFR2 | **Sybil resistance** — one human maps to exactly one World ID and exactly one ENS identity. |
| NFR3 | **Verifiability** — every published tally is independently reproducible with no backend access. |
| NFR4 | **Usability** — every flow is reachable through the real webapp UI. |

## Modules

| Module | Purpose | Done when |
| --- | --- | --- |
| 1 — Identity & ENS layer | Turns a World ID verification into a minted ENS identity | A fresh proof results in exactly one new ENS name and one `member` entity |
| 2 — Docket & policy layer | The "open a consultation" flow and its two-tier consent | A member without the docket-creation signature is blocked, with a clear reason |
| 3 — Comment submission engine | The IDKit / Agent Pass gate | An agent-drafted submission is provably blocked without a fresh, matching confirm |
| 4 — Arkiv entity layer | Single source of truth, hashed ownership throughout | Every entity is writable/queryable by hashed owner; comments expire with their docket |
| 5 — Recount & insights | Public-trust feature | The recount page's numbers match the live docket page's, computed independently |
| 6 — Frontend webapp | What people and judges actually use | Every use case is reachable by clicking through, start to finish |

## Implementation details — real calls, no mocked proofs

### World ID

The track permits mocked proofs for the hackathon; this project uses real ones — production World App for IDKit, production World IdP for Agent Pass. Full setup and demo script: [world/world-id.md](world/world-id.md).

```bash
npm i @worldcoin/idkit            # frontend
npm i @worldcoin/idkit-core       # backend (signRequest, hashSignal)
```

The backend decides action/signal/credential and signs the RP context ([backend/src/world/idkit.ts](backend/src/world/idkit.ts)):

```typescript
import { signRequest } from "@worldcoin/idkit-core/signing";

const sig = signRequest({ signingKeyHex: WORLD_ID_SIGNING_KEY, action, ttl: 300 });
// stored under sig.nonce with the action, signal (member + exact text hash) and credential
```

The browser only carries the proof ([frontend/world/WorldVerifyButton.tsx](frontend/world/WorldVerifyButton.tsx)):

```tsx
import { IDKitRequestWidget, proofOfHuman, selfieCheck } from "@worldcoin/idkit";

<IDKitRequestWidget
  open={open} onOpenChange={setOpen}
  app_id={req.app_id} action={req.action} rp_context={req.rp_context}
  environment="production" allow_legacy_proofs={req.allow_legacy_proofs}
  preset={req.credential === "selfie" ? selfieCheck({ signal: req.signal }) : proofOfHuman({ signal: req.signal })}
  handleVerify={(result) => api("/api/world/verify/comment", { body: { result } })}  // throws on denial
/>
```

The backend checks the result against the request it issued (nonce, environment, action, credential, `signal_hash == hashSignal(signal)`), then World's Developer Portal directly — the client's own claim of success is never trusted.

**Agent Pass** is World IdP OIDC step-up ([backend/src/world/agent-pass.ts](backend/src/world/agent-pass.ts)): `max_age=0`, `prompt=login`, essential `acr`, PKCE + state, and a nonce derived from the draft hash, so the World-signed ID token commits to the exact text approved.

**The drafting agent** ([backend/src/world/agent-interview.ts](backend/src/world/agent-interview.ts)) interviews the member and writes the comment in their words. It can never post — the draft goes through the same Agent Pass approval, with the position part of the approved hash.

### ENSv2

See [backend/src/ens/naming.ts](backend/src/ens/naming.ts). Each level of a name has its own registry, deployed through ENS's Verifiable Factory:

```typescript
// A member name is a token in the commentdesk.eth UserRegistry
await send(rootRegistry, userRegistryAbi, "register", [
  "maya", memberWallet, zeroAddress, platformResolver, MEMBER_TOKEN_ROLES, expiry,
]);

// A comment is a real name owned by its author, with its records on the docket's resolver
await send(docketRegistry, userRegistryAbi, "register", [
  label, authorWallet, zeroAddress, docketResolver, 0n, expiry,
]);
```

**ENS decides, Arkiv only records the result.** Every comment first reads the docket's `status` and `commentdesk.agents` text records straight from ENS, through the Universal Resolver. If ENS says the docket is closed, nothing is written to Arkiv — even if Arkiv's own copy still says open ([backend/src/desk.ts](backend/src/desk.ts), `assertEnsAllows`). `npm run e2e -w backend` reproduces this step against real Sepolia and Rabdi.

### Arkiv

See [backend/src/arkiv/](backend/src/arkiv/). Only filter columns are indexed; comment text lives in a `bytes()` column:

```typescript
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

export const CommentSchema = defineSchema("commentdesk_comment_v1", {
  docket_key: str().indexed(),
  topic: str().indexed(),
  owner_hash: str().indexed(),
  author_type: str().indexed(),
  submitted_at: u64().indexed(),
  stance: bytes(),
});

await wallet.createEntity(CommentSchema, values, {
  expiration: ExpirationTime.atBlock(docketExpiresAt),
  flags: { readonly: true },
});
```

Comments are readonly, so they can never be edited, and expire at their docket's exact block. Queries use `.createdBy(publisher)`: `$owner` can change hands, `$creator` can't.

### Swarm

```typescript
import { Bee } from "@ethersphere/bee-js";

const { reference } = await bee.uploadFile(
  stampBatchId,
  Buffer.from(JSON.stringify({ ruling, comments: closedComments })),
  `${docketKey}-archive.json`,
);

await walletClient.updateEntity(docketKey, {
  attributes: [{ key: "swarm_ref", value: reference.toString() }],
});
```

Reading it back is a plain fetch against the Bee node's `/bzz/` endpoint — reproducible per [arkiv/swarm.md](arkiv/swarm.md).

## Required judging deliverables (Arkiv track, verbatim requirements)

The Arkiv track is judged off these files plus a reproducible query — every file answers its stated question with real links, numbers, or a runnable query, written from what actually happened building this:

| File | Must contain |
| --- | --- |
| `/arkiv/schema.md` | The four entities, their queryable fields, who owns each, when each expires |
| `/arkiv/friction.md` | One concrete thing that got in the way, one thing missing that would've helped |
| `/arkiv/reach.md` | Who this is for, whether it's try-able today, whether building continues after Mumbai |
| `/arkiv/why-arkiv.md` | What's lost if Arkiv were swapped for Postgres; what's deliberately kept off Arkiv |
| `/arkiv/how-you-use-arkiv.md` | Confirms every Arkiv feature used changes something a user actually sees |
| `/arkiv/swarm.md` | Required for the Swarm bonus |

**Publisher wallet (`$creator` of every Arkiv entity):** `0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310`

```bash
cd backend && npm install
npm run recount -- <docketKey> 0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310
```

```typescript
// one query a judge can run: every comment on a given docket, newest first
await client
  .select({ $key: true, topic: true, sentiment: true, stance: true })
  .from(CommentSchema)
  .createdBy("0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310")
  .where(eq("docket_key", DOCKET_ENTITY_KEY))
  .orderBy(desc("submitted_at"))
  .limit(50)
  .fetch();
```

## Project layout

```
CommentDesk/
├── frontend/          Next.js 16 — join flow, dockets, recount, /activity feed
│   ├── app/
│   ├── components/
│   └── world/          World ID client components
├── backend/           Node/TypeScript — Hono + Express
│   ├── src/
│   │   ├── world/      IDKit, Agent Pass, drafting agent
│   │   ├── ens/         ENSv2 naming
│   │   ├── arkiv/       Entity writer, schemas, estimate/write-guard
│   │   └── shared/      WorldGateHost — the Arkiv/ENS ↔ World interface
│   └── test/
├── contracts/         ENSv2 Sepolia deployment + Arkiv entity schemas
├── arkiv/              Arkiv track judging deliverables (schema, friction, reach, why, how, swarm)
├── ens/                 ENS track writeup
├── world/              World ID track writeups + demo script
├── .gitignore
├── LICENSE
└── package.json         npm workspaces root
```

## Deployed addresses

| What | Address |
| --- | --- |
| Arkiv publisher wallet (wrote every entity, Rabdi) | `0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310` |
| ENS operator wallet (Sepolia) | `0x0B3Fc3CFfe64ee1B0511Add4e9a190c8447C281C` |
| ENS moderator wallet (Sepolia) | `0xf103d9919b3775d066b2F188B7D62C1E1Ff5f6B7` |
| `commentdesk.eth` UserRegistry (Sepolia) | `0x17B267C1FC1FE02fD4FE818265b0727a2B9728ed` |
| Platform resolver (Sepolia) | `0x825a0C175b9F18EFf234fB7ff019eecE73687331` |

## Security and honest gaps

This is explicitly the mini (hackathon) version — one platform instance, a handful of dockets, enough to prove the mechanism end to end, not a production-scale civic infrastructure deployment. Stated plainly rather than hidden:

| Gap | Detail |
| --- | --- |
| Root emancipation is partial | `commentdesk.eth`'s root registry is emancipated ([tx](https://sepolia.etherscan.io/tx/0xaaa8af72870c4e6cded1d39289d1365f025151e415f190f28f22adf008d35b5b)) — the operator can't override a member's resolver/subregistry at the root. It still keeps `SET_PARENT` on each member's/docket's own subname registry. Detail: [ens/key-features.md](ens/key-features.md#known-gap-stated-honestly) |
| Comment text isn't encrypted | Anyone who can see an entity can read its content. Field-level privacy needs ZK/FHE, not available on this stack today. |
| ENS ownership is public | A member's name links openly to their wallet — the hash stops casual Arkiv scanning, not someone starting from an ENS name. |
| One publisher wallet signs every Arkiv entity | `$creator` proves this app published a record, not that a given person wrote it. Recounting proves the tally matches published records, not that every record is genuine. |
| 182-day entity lifetime | Arkiv's maximum; Lifetime Extension isn't automated yet. |
| No passkey recovery | A lost passkey has no recovery path; World ID's one-identity rule also blocks rejoining with a new one. |
| Single backend process | Arkiv has no unique constraint, so uniqueness checks are serialized in memory. |
| Minimal moderation | A Moderator can close a docket early; there's no appeals process yet. |

## How we used AI

We used Claude Code to research the ENSv2 and Arkiv contracts and SDKs, and to write much of the backend, the frontend and these docs, under our direction and with our review. The product idea, its design and the specification are ours.

## License

[MIT](LICENSE).
