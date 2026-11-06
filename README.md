# Comment Desk — a platform for verifiable public input

Built for ETHGlobal Mumbai, Nov 2026. Uses World ID (identity + Agent Pass), Arkiv, and ENS.

**The one-line pitch**: it feels like Reddit or X — people post under dockets, reply, see counts go up — but every post is tied to one real, unique human, and a docket isn't a feed that scrolls away. A docket is a case: it opens, collects input against a deadline, **concludes** with a published ruling or response, and the full record of who-said-what stays queryable forever (or until its stated expiry), by anyone, independent of the platform. Reddit has no deadline, no conclusion, no Sybil resistance, and no record you can recount yourself. That gap is the entire product.

## Terminology: what "docket" means here

"Docket" isn't being borrowed loosely from Web3 jargon — it's being used the way it's actually used in law and regulation, which is exactly the domain this project sits in. A docket is the formal record of a proceeding: every filing, every submission, every update, tracked against one case or one decision. That's the same sense people mean when they track the SEC v. Ripple or SEC v. Coinbase docket for the latest motions and rulings, or when the FTX, Celsius, and Voyager bankruptcy dockets list every creditor claim and recovery update.

Comment Desk's docket is the same concept, applied to a different kind of proceeding: not a lawsuit, but a public consultation — a regulatory comment period, a DAO's open question, a community's decision in progress. Same structure (a case, its filings, its record), different proceeding. Worth stating this plainly in the pitch, because a judge who knows the term from SEC filings should immediately recognize why it fits, not wonder if it's decoration.

## Confirmed: the Arkiv + Swarm bonus is real

The official track text confirms it: **Arkiv + Swarm bonus (from scratch) — $500**, on top of whatever Arkiv track prize is won (doesn't use another of the three ETHGlobal sponsor picks). Qualifying needs both Arkiv and Swarm used meaningfully — Swarm alone doesn't count.

What Comment Desk puts on Swarm: a **docket's concluding record** — the full published ruling/response text, plus the closed docket's complete comment archive as a single file — once the docket closes. This is the natural fit, not a bolted-on integration: the live, mutable state (open dockets, live tallies) stays on Arkiv where expiry and queryability matter; the final, permanent "case record" moves to Swarm once there's nothing left to mutate, and the Arkiv `docket` entity holds a pointer to it.

Required before submission — `/arkiv/swarm.md` must state:
- What's on Swarm (the closed docket's ruling + archive) vs. Arkiv (live state) — i.e. the paragraph above, with actual numbers.
- One real `docket` entity key and the Swarm reference it points to, with an openable link.
- The postage stamp batch ID used and which wallet bought it, and the Bee node/service uploaded through.
- Which files in the repo do the upload and the read-back.
- Steps to run one upload and one read.
- The exact moment in the demo video where Swarm is shown.
- What got in the way building the Swarm piece.

**Important caution from the track rules**: if a docket's archive is ever encrypted before upload, the decryption key must never be placed inside the Arkiv entity's Swarm-reference field as-is — Arkiv entities are public. Either encrypt the reference itself or keep the key off Arkiv entirely.

## Problem

AI makes fake public input free to produce at scale, and the platforms collecting that input mostly can't tell a real person from a script.

- CiviClick sent 20,000 AI-written comments to a Southern California air board using real residents' identities without their consent. The board voted 7-5 afterward.
- Washington State received roughly 37,000 fake AI comments, with the same names reused 50–100 times a night.
- The FCC's 2017 net-neutrality docket drew about 18 million fake comments out of 22 million total.

In every case, the portal only checked "did a submission arrive" — never "is a real, unique human behind it, right now." Web3 communities carry the same weakness: a DAO vote is only as trustworthy as "one wallet, one voice," which isn't the same as one human.

## Solution

Comment Desk is a platform, not a one-off tool. Any community, DAO, or regulator can open a **docket** — a question, a set of topics, a deadline — and collect input that's provably from real, unique humans, recountable by anyone, not just trusted to the platform's own database.

Every member joins by verifying once with World ID and is given a human-readable ENS name. Every docket they open becomes a subname under their identity; every comment under that docket becomes a further subname, each tied to exactly one verified human. People can let their own AI agent read a docket and draft a comment for them — but an agent can never submit on its own. Submission always needs a live, fresh human check, and which check depends on who actually authored the text:

- **A human typed it themselves** → a standard World ID (IDKit) check is enough. The act of writing it was already the human's own review.
- **An agent drafted it** → the full Agent Pass gate: a fresh, action-scoped confirm at the exact moment of submission, because authorship and human review were decoupled the moment the agent wrote it instead of the person.

That's the actual design principle, not a arbitrary choice: **the verification method matches how decoupled the content is from direct human judgment.**

Comment records carry a real expiry. The record of who-said-what lives on Arkiv, with owner keys hashed for privacy, queryable by anyone running a recount — not locked behind the docket owner's private server.

## Scope — mini (hackathon) version

**In scope:**
- One platform, multiple dockets, each with a few topics and a deadline.
- Member join flow: World ID verify + ENS subname mint. **Note on proofs**: the Agent Pass track now runs on mocked proofs by design — "you don't need sandbox app anymore," and the official note is explicit that these are fake identities not to be relied on for production. That's a track-level allowance, not a requirement to use it. This build still defaults to real Device-level verification through the production World App (stronger submission, matches the "no mocks" standard held throughout this session) and falls back to the track's mocked-proof path only if real verification becomes a live-demo risk on the day.
- Docket creation flow: a separate policy signature + docket entity creation.
- Two comment paths: human-typed (IDKit check) and agent-drafted (Agent Pass gate).
- Arkiv entity layer: `member`, `docket`, `comment`, `policy_acceptance` — each with real expiry where it matters.
- A live tally and a public recount page reading straight from Arkiv.
- A minimal analyst/insight view: aggregate counts per topic, no individual deanonymization.
- Basic access control: visitor / member / creator / moderator roles.

**Explicitly out of scope for the mini version** (future work, not pretend-solved):
- Any payment or financial layer. A wallet exists purely as the cryptographic key behind ENS and Arkiv — never for moving funds. This platform is not a payments product, and adding one would be scope creep with no connection to the actual problem.
- Full moderation tooling, dispute resolution, legal-grade evidentiary chain.
- Cross-chain ENS resolution beyond the single testnet used for the demo.
- Field-level encryption of comment text (ZK/FHE) — same honest limitation as any project on this stack right now.

## Use cases

1. A community admin opens a docket.
2. A person joins the platform (World ID verify → ENS mint → policy signature).
3. A person writes and submits their own comment (IDKit check only).
4. A person's agent drafts a comment using the docket plus aggregate insight, and the person approves it via Agent Pass before it posts.
5. Anyone recounts a docket's tally directly from Arkiv, independent of the platform's backend.
6. An analyst (human or agent) queries aggregate sentiment per topic without seeing raw identities.
7. The docket closes at its deadline; a response gets published; active comment records expire.

## Requirements (SRS)

### Functional

| ID | Requirement |
| --- | --- |
| FR1 | A verified human can mint exactly one ENS identity on this platform. |
| FR2 | A separate policy signature is required at join, and again at docket creation — these are two distinct consents. |
| FR3 | Docket creation is only possible for a member who has completed the docket-creation policy signature. |
| FR4 | At most one *counted* comment per member per topic per docket; extra comments (capped, e.g. 3) are stored but ignored in the recount. |
| FR5 | A human-authored comment requires an IDKit verification at submission. |
| FR6 | An agent-authored comment requires a fresh Agent Pass confirm, scoped to the exact draft text, at submission. |
| FR7 | Comment records expire at docket close plus a grace period. |
| FR8 | A recount function reads directly from Arkiv and is independent of the platform's own backend or API keys. |
| FR9 | An aggregate insight query returns counts/sentiment per topic without resolving to a raw identity. |
| FR10 | Every entity's owner field is a hash of the underlying wallet address, never the raw address. |

### Non-functional

| ID | Requirement |
| --- | --- |
| NFR1 | **Privacy** — no entity stores a name, physical address, or other PII; only a hashed identity key. |
| NFR2 | **Sybil resistance** — one human maps to exactly one World ID and exactly one ENS identity, platform-wide. |
| NFR3 | **Verifiability** — every published tally must be independently reproducible by a third party with no backend access. |
| NFR4 | **Usability** — every flow above is reachable through a real webapp UI, not just an API call. |

## Identity and naming model

**World ID** establishes that one real, unique human exists behind an identity — this is the Sybil-resistance layer, and it's what a shared registry actually needs (see "why World ID" below).

**ENS** makes that identity, and everything it creates, a human-readable, resolvable name instead of a hidden wallet hash:

```
maya.commentdesk.eth                              ← Maya's identity, minted on join
truck-emissions-rule.maya.commentdesk.eth          ← a docket Maya opened
comment-1.truck-emissions-rule.maya.commentdesk.eth ← one comment under it
```

Clicking through that chain in the demo is the whole pitch made visible: a person, their docket, their comment — each a real name you can resolve, not a row in someone's table.

**Why ENSv2, specifically, not legacy ENS**: this model mints a subname for every single comment — potentially thousands per docket. Legacy ENS subname issuance is expensive and slow at that volume. ENSv2's architecture is built for cheap, scalable subname minting off the expensive root-registration path. That's the actual technical reason to need it, not just "it's the newer one."

**Track requirement**: ENSv2 is live on Ethereum mainnet; the track accepts mainnet or Sepolia, and ENSv2 features must be central, not cosmetic. This build targets **Sepolia** for the demo (real ENSv2 contracts, not a mock), with mainnet left as a documented future step.

Two ENSv2-specific features earn their place beyond plain subname minting, not for bonus-chasing but because the platform actually needs them:
- **Enhanced Access Control (role-based permissions)**: a Moderator is granted the right to edit *only* a docket's `status` field (open → closed-for-cause) on names they don't own — exactly the role-based, field-scoped delegation Enhanced Access Control exists for, instead of the alternative of giving Moderators full ownership of every docket name.
- **Permissioned Resolver per subname**: each docket's subname gets its own resolver instance, so a Creator fully owns their docket's records (title, topics, deadline) without the platform or any other Creator able to touch them.
- **Agents as namespaces (bonus direction)**: when an agent drafts for a member, the agent itself can hold a child namespace under the member's name (e.g. `agent.maya.commentdesk.eth`), separate from the member's own identity — so a comment's provenance chain shows human vs. agent authorship as two distinct, resolvable names, not just a flag in a database row.

**Do we need a wallet?** Yes — but only as the cryptographic key behind ENS ownership and the hashed Arkiv owner field. Not for payment. Every member effectively has a lightweight wallet tied to their World ID session; they never see it as a "crypto wallet to manage," and the platform never asks them to hold funds. Keeping this boundary explicit matters because it's the difference between "a verifiable comment platform" and "yet another token-gated app" — the second one isn't the pitch.

**Human path vs agent path — which is "better"?** Neither is universally better; they're matched to risk, not ranked against each other:
- A human typing their own words already did the review in the act of typing — a single IDKit check (proof of personhood) is proportionate.
- An agent's draft was never reviewed by human judgment the way typing is — the extra Agent Pass gate exists specifically to recreate that missing review, at the one moment it actually matters: before the words become public and permanent-ish.

Using Agent Pass for *everything*, even human-typed comments, would be security theater — friction with no matching risk behind it. Using IDKit alone for agent-drafted content would leave the exact hole CiviClick exploited. The system has to tell these two cases apart and gate them differently, which it does by checking who authored the submitted text.

## Access control

| Role | Can do | Gained by |
| --- | --- | --- |
| Visitor | Read dockets, read the public recount | Nothing — open by default |
| Member | Comment, run analyst queries | World ID verify + ENS mint + join policy signature |
| Creator | Open a docket, publish its closing response | Member + docket-creation policy signature |
| Moderator | Flag or close a docket early for policy violations | Platform-level grant, not self-service |

Per-docket credential level (set by the Creator when opening it) adds a second axis: a "serious" docket can require Proof of Human (orb-level) for every comment on it, while a casual one can accept the lighter, explicitly-labeled-"soft" Proof of Presence. This stays visible on the docket page so nobody mistakes a soft-verified tally for a strict one.

## Arkiv entity schema

| Entity | Owner | Key fields | Expiry |
| --- | --- | --- | --- |
| `member` | Hash of wallet | ENS name, World ID nullifier reference, join-policy signature ref | Never |
| `policy_acceptance` | Hash of wallet | which policy (join / docket-creation), timestamp | Never |
| `docket` | Hash of creator's wallet | title, topics, deadline, credential level | Deadline + grace period |
| `comment` | Hash of commenter's wallet | docket ref, topic, stance text, author type (human/agent), proof ref | Docket's expiry |

Owner keys are hashed, not raw — same principle as the rest of this session's work: a passive observer scanning Arkiv can't casually deanonymize a commenter without already knowing their wallet.

## Modules

### Module 1 — Identity & ENS layer
**Purpose**: turns a World ID verification into a minted, resolvable ENS identity.
**In scope**: World ID verify call, ENSv2 subname minting for the member, writing the `member` entity.
**Out of scope**: deciding who's allowed to do what with that identity — that's access control's job.
**Done when**: a fresh World ID proof results in exactly one new ENS name and one `member` entity, never two for the same human.

### Module 2 — Docket & policy layer
**Purpose**: the "open a consultation" flow, and the two-tier consent it requires.
**In scope**: join-policy and docket-creation-policy signature capture, docket entity creation, minting the docket's ENS subname.
**Out of scope**: comment submission itself.
**Done when**: a member who hasn't signed the docket-creation policy is blocked from opening one, with a clear reason shown.

### Module 3 — Comment submission engine
**Purpose**: the two-path gate — IDKit for human-typed, Agent Pass for agent-drafted.
**In scope**: detecting which path applies, running the matching check, minting the comment's ENS subname, writing the `comment` entity with its author-type flag.
**Out of scope**: generating the agent's draft text — that's the user's own agent's job, this module only gates what it tries to submit.
**Done when**: an agent-drafted submission is provably blocked without a fresh, matching Agent Pass confirm, and a human-typed one goes through with IDKit alone.

### Module 4 — Arkiv entity layer
**Purpose**: single source of truth for all four entities, with hashed ownership throughout.
**In scope**: create/read/query functions for `member`, `policy_acceptance`, `docket`, `comment`.
**Done when**: every entity in the schema table above can be written and queried by hashed owner, and comments actually expire with their docket.

### Module 5 — Recount & insights
**Purpose**: the public-trust feature — anyone can reproduce the tally, and aggregate insight is available without deanonymizing anyone.
**In scope**: a recount page that re-derives counts straight from Arkiv; an aggregate query endpoint for sentiment/counts per topic.
**Done when**: the recount page's numbers match the live docket page's numbers, computed independently.

### Module 6 — Frontend webapp
**Purpose**: the thing people and judges actually use.
**In scope**: join flow, docket browser, comment composer (both paths), the ENS-name chain made visible and clickable, the recount page.
**Done when**: every use case above is reachable by clicking through the UI, start to finish, with no manual API calls.

## Step-by-step flow

**Joining**: visitor → World ID verify → ENS name minted → sign join policy → becomes a Member.

**Opening a docket** (Creator path): Member → sign docket-creation policy → fill in title/topics/deadline/credential level → docket entity written, ENS subname minted under the Creator's name.

**Human-authored comment**: Member opens a docket → writes their own stance → submits → IDKit check → `comment` entity written, ENS subname minted under the docket, author type = human.

**Agent-authored comment**: Member opens a docket → asks their agent to draft a stance (agent can read the docket and the aggregate insight for context) → reviews/edits the draft → submits → a fresh, draft-scoped Agent Pass confirm is required → on success, `comment` entity written, author type = agent, flagged accordingly. If the confirm is never completed, the draft expires and nothing posts.

**Demonstrating the required denied/unsuccessful paths** (both World ID tracks require this, not just a happy path):
- *Human path*: a member cancels the IDKit widget mid-flow, or a nullifier reuse is detected (already-commented-on-this-topic) → submission blocked, user sees why.
- *Agent path*: the Agent Pass confirm expires, is cancelled, or the draft text changes after the confirm was issued (so the signed scope no longer matches) → the draft is discarded, nothing posts. This is the case that actually matters for the pitch: an agent cannot quietly resubmit a different draft under an old approval.

**Recount**: anyone → opens the recount page → it queries Arkiv directly, re-derives the tally → compares against the docket's displayed numbers.

**Closing (concluding the case)**: deadline hits → Creator publishes a ruling/response → the full closed docket (ruling + comment archive) is uploaded to Swarm, and the `docket` entity is updated with the Swarm reference → active `comment` entities expire on schedule, but the Swarm record persists as the permanent case file.

## Why these choices, finalized

- **Wallet without payment**: a wallet is the cryptographic anchor for ENS ownership and Arkiv's hashed owner field — not a financial instrument. Adding payment would be unrelated scope for a platform whose entire value is verifiable speech, not value transfer.
- **ENSv2 over legacy ENS**: comment-level subname minting at volume needs ENSv2's cheaper subname path; legacy ENS wasn't built for that minting rate.
- **IDKit for human-typed, Agent Pass for agent-drafted**: matches the check's strength to how decoupled the content is from direct human review, rather than applying the heaviest check everywhere (theater) or the lightest everywhere (the exact hole CiviClick exploited).
- **Arkiv over a private database**: the entire pitch is "nobody has to trust the platform's own server" — storing the real tally in a private database would quietly undo that claim. Same reasoning as the rest of this hackathon's work: expiry enforced by the data layer, not by a cron job's uptime; ownership attribution that can't be quietly edited by whoever runs the backend.

## Tech stack

- **Identity**: `@worldcoin/idkit` (human path) and the Agent Pass confirm flow (agent path), real Device-level verification through production World App by default; the track's mocked-proof allowance kept as a documented fallback only.
- **Naming**: ENSv2 subname registrar on Sepolia, one contract call per mint (member, docket, comment, optionally agent-as-namespace), with Enhanced Access Control for the Moderator role and a Permissioned Resolver per docket.
- **Data**: `@arkiv-network/sdk` — same real API as the rest of this session's work (`createEntity`, `ExpirationTime`, `.createdBy()` queries using `$creator`, not `$owner`).
- **Archive**: Swarm (via Bee node/service) for the closed docket's permanent ruling + comment archive, referenced from the `docket` entity.
- **Frontend**: Next.js webapp — join flow, docket browser, comment composer, recount page.
- **Backend**: Node/TypeScript — routes the two comment paths, talks to Arkiv, the ENS registrar, and Swarm on docket close.

## Implementation details — real calls, no mocked proofs

### World ID — real verification, not the track's mocked-proof allowance

The track permits mocked proofs for the hackathon, but this project uses real ones: production World App for IDKit, production World IdP for Agent Pass. Full setup, credential rationale and demo script: [docs/world-id.md](docs/world-id.md). Debriefs: [docs/world-debrief.md](docs/world-debrief.md).

**As built (IDKit 4.6 — the IDKit 2 `IDKitWidget` / `verifyCloudProof` API is gone).** "Device-level" from the original plan isn't used: `deviceLegacy` is deprecated in IDKit 4 and doesn't prove uniqueness. Join uses Proof of Human; each docket's credential level picks Proof of Human (strict) or Selfie Check (soft).

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

The browser only carries the proof ([frontend/src/world/WorldVerifyButton.tsx](frontend/src/world/WorldVerifyButton.tsx)):

```tsx
import { IDKitRequestWidget, proofOfHuman, selfieCheck } from "@worldcoin/idkit";

<IDKitRequestWidget
  open={open} onOpenChange={setOpen}
  app_id={req.app_id} action={req.action} rp_context={req.rp_context}
  environment="production" allow_legacy_proofs={req.allow_legacy_proofs}
  require_user_presence={req.require_user_presence}
  preset={req.credential === "selfie" ? selfieCheck({ signal: req.signal }) : proofOfHuman({ signal: req.signal })}
  handleVerify={(result) => api("/api/world/verify/comment", { body: { result } })}  // throws on denial
  onSuccess={...} onError={...}
/>
```

The backend checks the result against the request it issued (nonce, environment, action, credential, `signal_hash == hashSignal(signal)`), then World's Developer Portal (`POST https://developer.world.org/api/v4/verify/{rp_id}`, payload forwarded as-is). It then reserves the per-action nullifier.

**Agent Pass** is World IdP OIDC step-up ([backend/src/world/agent-pass.ts](backend/src/world/agent-pass.ts)): `max_age=0`, `prompt=login`, essential `acr` (`https://world.org/oidc/acr/orb`), PKCE + state, and a nonce derived from the draft hash, so the World-signed ID token commits to the exact text approved. Cancel, expiry, a changed draft, a stale `auth_time`, a lower `acr` or a different World account each discard the draft.

The handoff to the Arkiv/ENS half is one interface, `WorldGateHost` ([shared/src/world-gate.ts](shared/src/world-gate.ts)): `onMemberVerified({ humanVerified: true, proofRef, … })` and `onCommentVerified({ humanVerified: true, proofRef, … } | { agentConfirmed: true, draftKey, proofRef, … })`.

**Critical setup trap**: the app's environment (staging vs. production), the action's environment, and which client scans the QR code (Simulator vs. real World App) must all match. A production action scanned by the Simulator — or a staging action scanned by the real World App — silently returns zero proofs and looks exactly like a frontend bug. Register one production action for the real demo; keep a separate staging action only if you need repeatable automated testing.

### ENSv2 — real subname minting

```bash
npm i viem
```

```typescript
import { createWalletClient, http } from "viem";
import { namehash } from "viem/ens";
// ENSv2's subname registrar contract call — mint under the platform's root name
const tx = await walletClient.writeContract({
  address: ENSV2_REGISTRAR_ADDRESS,
  abi: ensV2RegistrarAbi,
  functionName: "register",
  args: [labelFor(member.ensHandle), parentNode, member.wallet, expiry],
});
```

Each of the three mint points — member join, docket creation, comment submission — calls this same registrar function with a different parent node (platform root, the creator's name, the docket's name respectively).

### Arkiv — same real SDK as the rest of this session

```typescript
import { createWalletClient, createPublicClient, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { kaolin } from "@arkiv-network/sdk/chains";   // confirm this matches the hackathon's actual chain ID first
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";

const { entityKey } = await walletClient.createEntity({
  attributes: [
    { key: "type", value: "comment" },
    { key: "creator", value: hashedWallet },
    { key: "docket", value: docketKey },
    { key: "topic", value: topic },
  ],
  payload: jsonToPayload({ stance, authorType, proofRef }),
  expiresIn: ExpirationTime.fromDays(docketDeadlineDays),
});
```

Query by `.createdBy(hashedWallet)` / `$creator`, not `$owner` — same reasoning as the rest of this session: `$owner` can change hands, `$creator` can't, and the trust claim depends on that.

### Swarm — the closed-docket archive, real upload via a Bee node

```bash
npm i @ethersphere/bee-js
```

```typescript
import { Bee } from "@ethersphere/bee-js";

const bee = new Bee("https://your-bee-node:1633");

// upload the closed docket's ruling + full comment archive as one file
const { reference } = await bee.uploadFile(
  stampBatchId,                       // the postage stamp batch bought for this upload
  Buffer.from(JSON.stringify({ ruling, comments: closedComments })),
  `${docketKey}-archive.json`
);

// write the reference back onto the Arkiv docket entity — never the decryption
// key, if the archive is encrypted; see the caution in the Swarm bonus section
await walletClient.updateEntity(docketKey, {
  attributes: [{ key: "swarm_ref", value: reference.toString() }],
});
```

Reading it back is a plain fetch against the Bee node's `/bzz/` endpoint using that reference — the function judges can run themselves per `/arkiv/swarm.md`.

### Enhanced Access Control — scoping the Moderator role

```typescript
// grant the Moderator role edit rights on exactly the `status` field of a
// docket's Permissioned Resolver, without transferring ownership of the name
await walletClient.writeContract({
  address: PERMISSIONED_RESOLVER_ADDRESS,
  abi: permissionedResolverAbi,
  functionName: "grantRole",
  args: [docketNode, MODERATOR_STATUS_ROLE, moderatorWallet],
});
```

## Required judging deliverables (Arkiv track, verbatim requirements)

The Arkiv track is judged entirely off these files plus a reproducible query — not off the pitch. Every one of these must exist in the repo and answer its stated questions with real links, numbers, or a runnable query, written from what actually happened building this, never generic praise:

| File | Must contain |
| --- | --- |
| `/arkiv/schema.md` | The four entities above, their queryable fields, who owns each, and when each expires — the table in "Arkiv entity schema," expanded with real field names from the code. |
| `/arkiv/friction.md` | One concrete thing that got in the way building on Arkiv, and one thing missing that would've made it easier. A reproducible bug report if anything broke: expected vs. actual vs. repro steps. |
| `/arkiv/reach.md` | Who this is for (regulators, DAOs, community platforms fighting fake-comment floods), whether they'd actually use it, whether it's try-able today, and whether building continues after Mumbai. |
| `/arkiv/why-arkiv.md` | What's lost if Arkiv were swapped for Postgres: the independently-recountable tally (FR8), the hashed-but-unforgeable `$creator` attribution, and the expiry enforced by the data layer instead of a cron job. What's deliberately kept *off* Arkiv: comment text's plaintext isn't ZK/FHE-protected yet — stated as an honest gap, not hidden. |
| `/arkiv/how-you-use-arkiv.md` | Confirms the filtered fields (docket ref, topic, author type, `$creator`) match what the app actually does; confirms each entity's editability (who can mutate what) and expiry (docket deadline + grace) are real product requirements, not arbitrary defaults; confirms every Arkiv feature used changes something a user actually sees (the live tally, the recount page, the expiry countdown). |
| `/arkiv/swarm.md` | As detailed above, if entering the Swarm bonus. |

The README itself must also state, per the track's qualification requirements: the wallet address(es) that wrote the project's entities (filled in once deployed — e.g. `0x...` for the demo's platform-operated member/docket-creation wallet), and one query a judge can run directly, e.g.:

```typescript
// one query a judge can run: every comment on a given docket, newest first
await publicClient.queryEntities({
  where: eq("type", "comment"), and: eq("docket", DOCKET_ENTITY_KEY),
  orderBy: "createdAt", direction: "desc",
});
```

## Build phases

0. Scaffold — repo structure, World ID app registration, ENSv2 testnet registrar setup, Arkiv testnet access.
1. Identity & ENS layer (Module 1) — join flow, one ENS name per verified human.
2. Docket & policy layer (Module 2) — two-tier policy signatures, docket creation.
3. Arkiv entity layer (Module 4) — before Module 3, since the comment engine depends on it.
4. Comment submission engine (Module 3) — both paths, the core of the pitch.
5. Recount & insights (Module 5).
6. Frontend webapp (Module 6) — can start in parallel against mocked data once Module 2's shapes are agreed.
7. Swarm archive on docket close — upload the ruling + comment archive on close, write the Swarm reference back into the `docket` entity.
8. Integration pass — walk every use case above end to end, including both required denied/expired paths (human cancel/reuse, agent-confirm expiry/mismatch).
9. Judging docs — `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`, `swarm.md`, written from what actually happened building this, not generic praise. Fill in the wallet address(es) and the sample query in the README.

## Honest gaps and future work

- Comment text itself isn't encrypted — anyone who can see an entity can read its content. Field-level privacy needs ZK/FHE, not available on this stack today.
- Moderation is minimal in this version — a Moderator can close a docket early, but there's no appeals or dispute process.
- The analyst insight layer aggregates counts and sentiment but doesn't yet do anything smarter (trend detection, cross-docket analysis) — that's a natural next step, not built in this scope.
- This is explicitly the mini version: one platform instance, a handful of dockets, enough to prove the mechanism end to end — not a production-scale civic infrastructure deployment.