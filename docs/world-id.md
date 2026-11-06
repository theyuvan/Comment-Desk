# World ID in Comment Desk: setup, flows, demo script

This is the World half of Comment Desk: IDKit (join and human-typed comments), World ID Agent Pass
(agent-drafted comments) and the built-in drafting agent. It lives in
[backend/src/world/](../backend/src/world/) and starts from one entry point,
[`startWorldGates`](../backend/src/world/start.ts). It hands every verified result to the Arkiv/ENS
half through one interface, `WorldGateHost` in [shared/src/world-gate.ts](../shared/src/world-gate.ts),
which [`DeskWorldHost`](../backend/src/host/desk-host.ts) implements. That class writes the Arkiv
entities and mints the ENSv2 names.

## The trust moments and the credential each one gets

| Moment | What we must know | Check | Why this and not more or less |
| --- | --- | --- | --- |
| **Join** (mint the one ENS name) | This is a unique human who has never joined before | IDKit 4 uniqueness proof, action `commentdesk-join`, **Proof of Human** by default (`WORLD_ID_JOIN_CREDENTIAL`). The signal binds the handle and the member's passkey wallet | The registry rests on "one human, one name". That's a uniqueness question, and Proof of Human is the credential built for it. Passport or NFC would prove nationality and document data we don't need and must not store. |
| **Human-typed comment** | A real human is submitting *these words, with this position*, right now, and hasn't already commented on this topic | IDKit 4 uniqueness proof, one action per (docket, topic). The signal binds the member and `sha256(docket, topic, position, text)`. `require_user_presence: true`. Credential follows the docket: **strict → Proof of Human**, **soft → Selfie Check** | Typing is the human review, so one proof at submit is proportionate. The per-topic action makes the nullifier mean "already commented here". The position is in the signal because the tally counts it. |
| **Agent-drafted comment** | The member, not just "a human", freshly approved *this exact draft and position* | World ID Agent Pass: World IdP OIDC step-up with `max_age=0`, `prompt=login`, essential `acr` (Orb by default), PKCE, state, and a nonce frozen to the draft hash | No human reviewed the agent's words as they were written, so we recreate that review at the one moment it matters. The OIDC nonce is `sha256(draftHash ‖ salt)`, so the World-signed ID token itself commits to the approved text and position. After the first approval the member's World account `(iss, sub)` is linked, and later approvals must come from the same account. |

**Deviation from the original spec:** the README asked for "Device-level" verification. IDKit 4.x
marks `deviceLegacy` deprecated (it returns only World ID 3.0 proofs), and a device check doesn't
establish uniqueness, which the join step needs. The build therefore uses Proof of Human (Orb) by
default and Selfie Check for soft dockets. Both are real production World App credentials, with
no mocked proofs. If demo users don't hold an Orb credential, set `WORLD_ID_JOIN_CREDENTIAL=selfie`.

## The drafting agent

On a docket's **My agent drafted this** tab, the Comment Desk agent interviews the member, one
question at a time: which topic, support / oppose / neutral, their reasons, and any first-hand
experience. It then writes the comment in their words and parks it as an agent draft through its only
tool, `save_draft`. From there it is an ordinary agent draft: the member reviews it, may edit it, and
posts it only by approving that exact text with Agent Pass. The result is published as
`agent.<name>.commentdesk.eth` with "agent drafted · human approved".

- **It can't post.** It has one tool, and that tool can only create or revise a draft.
- **It writes only what the member said.** The instructions forbid inventing facts, figures,
  credentials or anecdotes, or adding arguments the member didn't make.
- **It sees the docket and the live tally as context, never as instructions.** The docket text is
  written by its creator, so it's fenced off as data. The agent is told not to steer the member
  toward or away from the majority.
- **Interviews stay in memory and expire** (`AGENT_INTERVIEW_TTL_SECONDS`). Only the approved comment
  becomes public.
- Model: `claude-opus-5-5` (`AGENT_MODEL`), with server-side fallback if a request is declined.
  Without `ANTHROPIC_API_KEY` the agent is off, and members bring their own agent with a token from
  `/agent` (`npm run agent -w backend -- draft …`).

**Why the record is useful to researchers:** every counted comment on Arkiv carries its author type
(`human` / `agent`), its position, and a proof reference. That reference is `idkit:…` for a typed
comment and `agentpass:…` for an approved agent draft. A researcher can therefore separate
human-typed from agent-assisted comments in the tally, and know that each is one verified human's
own position.

## What the backend enforces (never the client)

IDKit ([backend/src/world/idkit.ts](../backend/src/world/idkit.ts)):
- The backend chooses `action`, `signal` and credential, signs `rp_context` with the RP signing key,
  and stores the request under its nonce. The browser only carries the proof.
- On verify, all of these must hold:
  - The request exists, is unused and is unexpired.
  - It comes from the same session.
  - `environment` matches.
  - The protocol is 4.0 (3.0 only if legacy is enabled for Proof of Human).
  - `action` matches.
  - The response's credential identifier matches.
  - `signal_hash == hashSignal(signal)`.
  - Finally, `POST developer.world.org/api/v4/verify/{rp_id}` must return `success`.
- Nullifiers are stored as decimal per action. On join, a reused nullifier signs the human back in
  to their existing member, so no second name is minted. This also works if the World store was lost,
  because `DeskWorldHost` finds the member by the nullifier on Arkiv. On a comment, a reused nullifier
  is blocked (`nullifier_reused`).
- What posts is the text and position stored when the request was issued. The client can't swap either.
- If the desk refuses after a proof passed (for example `docket_closed` or `already_commented`), that
  reason is shown to the user and the nullifier is released, so the proof isn't burned.

Agent Pass ([backend/src/world/agent-pass.ts](../backend/src/world/agent-pass.ts)):
- Start is a form POST, so the member's SameSite=Lax cookie can't be used to start a confirm from
  another site. It snapshots the draft hash and sets a TTL (`AGENT_PASS_CONFIRM_TTL_SECONDS`).
- On the callback, all of these must hold before anything posts:
  - The state is known and single-use.
  - It comes from the same session.
  - There is no IdP `error`. Any error discards the draft; `access_denied` means "cancelled".
  - The attempt hasn't expired.
  - The code redeems with PKCE, state and nonce. openid-client checks the signature, `iss`, `aud` and `exp`.
  - `acr` is in the accepted list.
  - `auth_time` falls inside this attempt.
  - `(iss, sub)` matches the linked account, or isn't linked to anyone else.
  - The draft is still awaiting *this* attempt, and its hash equals the snapshot.
- Only then does the comment post, with author type `agent`.
- Every failure discards the draft. Abandoned confirms expire on their own (lazy sweep). An agent can
  rewrite its draft (text or position) at any time; a rewrite during a confirm makes that confirm fail
  (`draft_changed`).

## Setup

1. **IDKit app**: at <https://developer.world.org>, create a **production** app and note `app_id`,
   `rp_id` and the signing key (shown once). Actions are created on the fly and bound by the RP
   signature, with `action_description` shown in World App.
2. **Agent Pass client**: at <https://auth.world.org/portal>, register an OIDC client with redirect URI
   `https://localhost:3000/api/agent-pass/callback` (HTTPS, exact match), or your tunnel's origin.
3. Create `backend/.env` from `backend/.env.example`:
   - Fill in the World values. Use `openssl rand -hex 32` for `SESSION_SECRET`.
   - Get the Arkiv and ENS keys from the team privately.
   - Optionally set `ANTHROPIC_API_KEY` for the drafting agent.
   - Leave `WORLD_GATE` empty: `dev` swaps in an unverified stand-in.
4. `frontend/.env.local`: `WORLD_BACKEND_URL=http://localhost:4000`.
5. Install and run, in two terminals:
   ```bash
   npm install
   npm run dev -w backend          # Desk API on :8787 (Arkiv, ENS, Swarm), World gates on :4000
   npm run dev -w frontend         # https://localhost:3000 (self-signed; /api routed to both)
   npm test                        # 58 desk tests + 28 World and agent tests, every denied path included
   ```
   Without the Arkiv/ENS keys yet, run `npm run dev:memory:world -w backend` instead. It uses the
   **real** World gates, with Arkiv, ENS and Swarm in memory, and the app shows a memory banner.

**Environment trap:** a production app or action only answers the real World App, and staging only
answers the Simulator. A mismatch looks like a frontend bug. The backend rejects any proof whose
`environment` isn't `WORLD_ID_ENVIRONMENT`, and says so (`wrong_environment`).

**Mocked-proof fallback:** not used. If real verification becomes a live-demo risk, the fallback is
`WORLD_ID_ENVIRONMENT=staging` plus the Simulator for IDKit, and `AGENT_PASS_ISSUER=https://sandbox.auth.world.org`
for Agent Pass. The same code paths run; only the issuers change. If we fall back, the demo must say
so: sandbox identities are not real humans.

## Demo script (every path the World tracks require)

1. **Join**: at `/join`, pick `maya`, create the passkey, then *Verify with World ID and join*. Scan
   with World App, and you get `maya.commentdesk.eth`.
   - *Alternative path:* join again with a new passkey and handle. World recognises the same human,
     you see "Welcome back", and no second name is made.
2. **Open a docket** at `/dockets/new` with a short deadline.
3. **Human comment**: on the docket, *I wrote this*, pick a topic and position, type, then
   *Verify with World ID and post*. It posts as `maya.commentdesk.eth`.
   - *Denied (cancel):* start again and cancel in World App. "You cancelled… Nothing was posted."
   - *Denied (one per topic):* comment again on the same topic. "You've already commented on this topic."
4. **Agent comment**: on *My agent drafted this*, answer the agent's questions. The draft appears
   below with its position and hash. *Approve with World ID Agent Pass* runs a fresh World IdP login,
   then you're back on the docket with the comment posted as `agent.maya.commentdesk.eth` and labelled
   "agent drafted · human approved".
   - *Denied (draft changed):* start an approval, and while World is asking, have the agent revise the
     draft (or run `npm run agent -w backend -- edit …`). Finish the approval: "The draft changed
     after approval was requested. It was discarded — nothing posted."
   - *Denied (cancel or expiry):* cancel at World, or wait out the countdown (set
     `AGENT_PASS_CONFIRM_TTL_SECONDS=30` for the demo). The draft is discarded.
5. **Recount** at `/dockets/<key>/recount`. The browser reads Arkiv directly and reproduces the
   tally, human and agent counted separately.
