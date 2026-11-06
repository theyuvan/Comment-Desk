# ENSv2 — how we use it, and why it's central, not cosmetic

For the **Best Use of ENSv2** track. Built on ENSv2 on Ethereum Sepolia. Deployed contracts and
the Sepolia ENS app link are in the main [README](../README.md#deployed-addresses).

## How we use ENSv2

Every name in Comment Desk is a real ENSv2 name with its own registry and resolver, not a row in
our database that happens to display one:

| Name | Who | Registry | Resolver |
| --- | --- | --- | --- |
| `commentdesk.eth` | The platform | Root | Platform resolver |
| `maya.commentdesk.eth` | One verified human | Member registry | Her own, the operator holds no role on it |
| `agent.maya.commentdesk.eth` | Her agent | Same member registry | Her own |
| `truck-rule.maya.commentdesk.eth` | One docket | Its own registry | Its own, with Enhanced Access Control |
| `comment-1.truck-rule.maya…` | One comment | The docket's registry | The docket's resolver |

Three ENSv2 primitives do real work here, not a plain subname mint:

- **Permissioned Registry.** Member and docket registries give the operator only `ROLE_REGISTRAR`
  and `ROLE_RENEW` — the same model as the `.eth` registrar itself — so the operator can register
  and renew but never touch a name once it exists.
  [`backend/src/ens/naming.ts:197`](../backend/src/ens/naming.ts#L197), `MEMBER_TOKEN_ROLES` in
  [`contracts/ens/sepolia.ts:91`](../contracts/ens/sepolia.ts#L91).
- **Permissioned Resolver.** Each docket deploys its own resolver instance. Roles are granted key
  by key during the one deployment transaction — the Creator can set `status`/`title`/`deadline`/
  `topics`/`credential`/`agents`, a Moderator can set only `status`, the operator can set only the
  comment-linking keys — and nobody holds text admin once deployment finishes.
  [`backend/src/ens/naming.ts:241`](../backend/src/ens/naming.ts#L241) (`grantSetterRoles`).
- **Non-transferable identity.** Member names withhold `ROLE_CAN_TRANSFER_ADMIN`, so a verified
  identity can never be sold or handed to someone else.
  [`contracts/ens/sepolia.ts:88`](../contracts/ens/sepolia.ts#L88).

## Why it's central, not cosmetic

**ENS decides who can comment. Arkiv only records the result.** Before any comment is written to
Arkiv, the backend reads the docket's `status` and `commentdesk.agents` text records from ENS,
through the Universal Resolver — exactly the way any external wallet or app would read them, not a
cached copy. If ENS says closed, or says agents aren't allowed, nothing is written, even if Arkiv's
own copy of the docket still says open.
[`backend/src/desk.ts:370`](../backend/src/desk.ts#L370) (`assertEnsAllows`),
[`backend/src/ens/naming.ts:344`](../backend/src/ens/naming.ts#L344) (`docketRules`).

This is checked live, not by inspection: a moderator writes `closed-for-cause` to one ENS text
record and nothing else. The next comment attempt is refused with `docket_closed`, while Arkiv's
own `docket` entity still reads `open`. `npm run e2e -w backend` reproduces this exact step
(`== ENS decides who can comment`) against the real Sepolia and Rabdi networks, not a mock.

That's the test of "central, not cosmetic": pull ENS out, and the product's core promise — that
not even the platform's own server can keep a closed case open — stops being true.

## Functional, not hard-coded

Every name, role grant and resolver above is produced at runtime by the backend against live
Sepolia contracts — there are no pre-minted demo names or hard-coded addresses in the comment
flow. `npm run simulate:ens -w backend` replays the whole flow, including the denied paths, for
free against the real contracts; `npm run e2e -w backend` runs it end to end with real World ID,
Arkiv and Swarm in the loop.

## Known gap, stated honestly

`commentdesk.eth`'s root registry is not yet emancipated, so the platform operator currently still
holds the role to override a member's resolver or subregistry at the root, even though it never
does so in the app's own code paths. Emancipating the root (`npm run emancipate:ens -w backend`)
is a one-way action we're deciding on deliberately rather than rushing before judging — see the
main README's "Honest gaps" section.

## Feedback for ENS

- `grantSetterRoles`/`revokeRootRoles` during `initialize` work well for a one-shot, no-admin-left
  deployment, but there's no SDK or docs walkthrough for exactly that pattern — we worked it out by
  reading the resolver implementation directly. A documented "deploy with scoped per-key roles and
  immediately revoke admin" recipe would have saved real time.
- `isEmancipated()` and the dangerous-role list are easy to call once you know they exist, but
  nothing in the quickstart docs points a builder toward checking emancipation status before
  relying on "nobody can change this name" in their own pitch — we found the gap ourselves, late.
