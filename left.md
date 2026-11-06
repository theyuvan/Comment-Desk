# Comment Desk: what's done and what's left

For whoever connects World ID. Start with **What to do first**. The rest is reference.

## Where things are

| Branch | What it holds |
| --- | --- |
| `world-integration` | **Start here.** Everything merged: Arkiv, ENS, Swarm, the frontend and your World code |
| `comment-desk` | Arkiv, ENS, Swarm and the frontend, with a dev stand-in for World |
| `feat/world-id-gates` | Your original work, untouched |

## What to do first

The merge is done on `world-integration`. All 56 backend tests and your 20 World tests pass there, the frontend builds, and both servers start together. It has not had a real World proof through it yet, because that needs your credentials.

1. Get the branch:

   ```bash
   git fetch origin
   git checkout world-integration
   npm install
   ```

2. Create `backend/.env` from `backend/.env.example`.
   - Fill in your World values as usual.
   - Get the Arkiv and ENS values from Yuvan **privately**: `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`, `ENS_OPERATOR_PRIVATE_KEY`, `ENS_MODERATOR_PRIVATE_KEY`.
   - Leave `WORLD_GATE` empty. Setting it to `dev` turns on the stand-in, and your real widgets don't work against that.
   - World now uses `WORLD_PORT`, not `PORT`.

3. Create `frontend/.env.local` containing `WORLD_BACKEND_URL=http://localhost:4000`.

4. Run it, in two terminals:

   ```bash
   npm run dev -w backend     # API on :8787, World gates on :4000
   npm run dev -w frontend    # https://localhost:3000
   ```

5. Run the [real World test](#test-this-with-real-world) below. That is the last thing proving the two halves work together.

## What's complete

| Area | Status | How it was checked |
| --- | --- | --- |
| Arkiv: members, policies, dockets, comments | Done | Real writes on Rabdi |
| ENSv2: names for members, dockets, comments and agents | Done | Real Sepolia transactions, visible in the ENS app |
| Enhanced Access Control | Done | 57-step simulation on live contracts, 23 of them attacks that must fail |
| Permissioned Registry and Resolver | Done | Same simulation, plus live checks |
| Swarm: case file on close, compared with Arkiv | Done | Real uploads through the public gateway |
| Recount in the browser with no key or server | Done | Ran against real Arkiv and matched the tally |
| Passkey wallet | Done | 11 checks on a simulated authenticator. Not yet tried on a real phone or laptop |
| Frontend: join, dockets, open, comment, ruling, moderation, recount, pitch | Done | Full browser journey on real networks, 3 people, no errors, phone widths included |
| Connection to your gates | Done | `DeskWorldHost` tested. Your server issued a real request from the merged tree |

## What's left

### World (you)

- [ ] Run the [real World test](#test-this-with-real-world) on `world-integration`.
- [ ] Register `https://localhost:3000/api/agent-pass/callback` in the Agent Pass portal, or your tunnel's address.
- [ ] Update the docket slug in the commands shown by `AgentTokenPanel`. Docket keys are now `0x…` entity keys, not `truck-emissions-rule`.
- [ ] Update `docs/world-id.md`: it still describes `StubHost` and the old demo docket.
- [ ] Write the Agent Pass and IDKit debriefs for both World tracks.

### Yuvan

- [ ] Decide on emancipating `commentdesk.eth`. It's permanent: `npm run emancipate:ens -- --yes`. Until then the operator can still override member names at the root.
- [ ] Choose an open-source license. The Arkiv tracks require one.
- [ ] Make the repo public.
- [ ] Fill the `TO FILL` gaps: deployed URL and plans after Mumbai in `arkiv/reach.md`, demo timestamp in `arkiv/swarm.md`.
- [ ] Deploy, and record the demo with a fresh docket. Passkeys belong to one web domain, so members made on localhost won't carry over.
- [ ] Clear out the test dockets, or just leave them to expire about 7 days after their deadlines.
- [ ] Check our work against the Mumbai ENS prize page, which we couldn't open from here.

## Out of scope

Don't build these for Mumbai. They don't solve the problem this project is about.

| Idea | Why not |
| --- | --- |
| Blue ticks or badges | Already covered: World ID verifies the human, and `agent.maya…` plus "agent drafted, human approved" shows the agent and who stands behind it |
| Karma or reputation scores | That turns a consultation tool into a social network, and it adds rules nobody has designed |
| Storing signatures on comments | Worth doing later, but it changes the World flow this close to the deadline. It's listed as an honest gap instead |
| A registrar contract | The operator wallet registers names, which ENS allows. A contract adds risk without changing the demo |

## Test this with real World

This is the one thing nobody has run yet. Use a real World App and go in order:

1. **Join:** at `/join`, create a passkey, then verify with World App. You should get a real name, and no "unverified" tag.
2. **Human comment:** open a new docket with a short deadline, post a comment, and scan with World App.
3. **Cancel:** start a comment and cancel in World App. Nothing should post.
4. **One per topic:** comment twice on one topic. The second should be refused.
5. **Agent comment:** issue a token at `/agent`, park a draft with `npm run agent -w backend -- draft …`, then approve it on the docket's agent tab. You should come back to the docket with it posted.
6. **Draft changed:** edit a draft while its approval is in progress. It should be discarded.
7. **Close:** after the deadline, publish a ruling. The case file should reach Swarm and verify.
8. **Sign back in:** sign out, then sign in with the passkey. Commenting should still work.

## How the two halves connect

```
Browser ── /api/world, /api/session, /api/agent*, /api/drafts ──> World gates (:4000)
   │                                                                   │
   │                                                          DeskWorldHost
   │                                                                   │
   └──── everything else on /api ─────────────────────────────> Desk (:8787)
                                                              Arkiv, ENS, Swarm
```

- `backend/src/server.ts` runs both servers in one process.
- `backend/src/host/desk-host.ts` implements your `WorldGateHost`.
- `frontend/next.config.mjs` routes each path to the right server, so everything stays same-origin for your session cookie.

## What changed in your code

The merge moved or edited these, and nothing else:

| Change | Why |
| --- | --- |
| `backend/src/config.ts` moved to `backend/src/world/config.ts` | It collided with the Arkiv and ENS config |
| `backend/test/helpers.ts` moved to `backend/test/world-helpers.ts` | Same reason |
| `frontend/src/world/*` moved to `frontend/world/*` | The app uses `frontend/app`. Your other scaffold pages were removed |
| Added `sentiment` to comment requests and `CommentSubmission` | The tally shows support, oppose and neutral. Agent drafts default to neutral |
| Added `POST /api/session/wallet` and `deps.signIn` | A passkey restores a session without a new World proof |
| Frontend `dev` script keeps `--experimental-https` | Agent Pass needs HTTPS |

## Decisions to know about

| Topic | Decision |
| --- | --- |
| Comments per topic | One. Your nullifier already enforces this, so the README's "up to 3, first one counts" is dropped |
| Credential levels | `strict` is Proof of Human (Orb), `soft` is Selfie Check, matching your code. The README's "Proof of Presence" is gone |
| Join order | Passkey, then sign the join policy, then World. Your `onMemberVerified` is refused without that policy |
| Wallet at join | Required. Your optional `wallet` field now always carries the passkey's address, because the ENS name needs an owner |
| Second join by one human | Your behaviour: they sign back in and get no second name |

## Known limits

- A human who returns on a new device with no synced passkey can sign back in through World, but won't have their wallet. They can comment, but can't open dockets or publish rulings.
- A lost passkey has no recovery path.
- Our publisher wallet could still publish a fake comment. Recounting proves the tally matches the published records, not that every record is genuine.
- The backend must run as one process, because Arkiv has no unique constraint.
- Live joins and new dockets take a minute or two, because they wait for Sepolia blocks.
- Full details are in `backend/README.md` and the README's "Honest gaps" section.
