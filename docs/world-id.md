# World ID in Comment Desk — setup, flows, demo script

This is the World half of the work split: IDKit (join + human-typed comments) and World ID Agent
Pass (agent-drafted comments). It hands verified results to the Arkiv/ENS half through one
interface, `WorldGateHost` in [shared/src/world-gate.ts](../shared/src/world-gate.ts). Until that
half lands, [backend/src/host/stub-host.ts](../backend/src/host/stub-host.ts) stands in (in-memory,
not Arkiv, not ENS).

## The trust moments and the credential each one gets

| Moment | What we must know | Check | Why this and not more / less |
| --- | --- | --- | --- |
| **Join** (mint the one ENS name) | This is a unique human who has never joined before | IDKit 4 uniqueness proof, action `commentdesk-join`, **Proof of Human** by default (`WORLD_ID_JOIN_CREDENTIAL`) | The whole registry rests on "one human, one name" (FR1, NFR2). That's a uniqueness question, and Proof of Human is the credential built for it. Passport/NFC would prove nationality and document data we don't need and must not store (NFR1). |
| **Human-typed comment** | A real human is submitting *these words* right now, and hasn't already commented on this topic | IDKit 4 uniqueness proof, action per (docket, topic), signal bound to member + exact text hash, `require_user_presence: true`. Credential follows the docket: **strict → Proof of Human**, **soft → Selfie Check** | Typing is the human review, so one proof at submit is proportionate (FR5). The per-topic action makes the nullifier mean "already commented here" (FR4). Soft dockets accept Selfie Check because their stakes are lower, and the page labels them "soft" so nobody mistakes the tally for a strict one. |
| **Agent-drafted comment** | The member, not just "a human", freshly approved *this exact draft* | World ID Agent Pass: World IdP OIDC step-up, `max_age=0`, `prompt=login`, essential `acr` (Orb by default), PKCE + state + nonce frozen to the draft hash | No human reviewed the agent's words while they were written, so we recreate that review at the one moment it matters (FR6). The OIDC nonce is `sha256(draftHash ‖ salt)`, so the World-signed ID token itself commits to the approved text. After the first approval the member's World account `(iss, sub)` is linked, and later approvals must come from the same account. |

**Deviation from the original spec:** the README asked for "Device-level" verification. IDKit 4.x
marks `deviceLegacy` deprecated (it returns only World ID 3.0 proofs), and a device check doesn't
establish uniqueness, which the join step needs. The build therefore uses Proof of Human (Orb) by
default and Selfie Check for soft dockets. Both are real production World App credentials with
no mocked proofs. If demo users don't hold an Orb credential, set `WORLD_ID_JOIN_CREDENTIAL=selfie`.

## What the backend enforces (never the client)

IDKit ([backend/src/world/idkit.ts](../backend/src/world/idkit.ts)):
- The backend chooses `action`, `signal` and credential, signs `rp_context` with the RP signing key,
  and stores the request under its nonce. The browser only carries the proof.
- On verify: request exists, unused, unexpired; same session; `environment` matches; protocol 4.0
  (3.0 only if legacy is enabled for Proof of Human); `action` matches; the response's credential
  identifier matches; `signal_hash == hashSignal(signal)`; then `POST
  developer.world.org/api/v4/verify/{rp_id}` must return `success`.
- Nullifiers are stored as decimal per action. On join, a reused nullifier signs the human back in
  to their existing member, so no second name is minted. On a comment, reuse → `nullifier_reused`, blocked.
- The posted comment text is the copy stored when the request was issued. The client can't swap it.

Agent Pass ([backend/src/world/agent-pass.ts](../backend/src/world/agent-pass.ts)):
- Start is a form POST, so the member's SameSite=Lax cookie can't be used to start a confirm from
  another site. It snapshots the draft hash and sets a TTL (`AGENT_PASS_CONFIRM_TTL_SECONDS`).
- Callback: state is known and single-use; same session; IdP `error` → discard (`access_denied` → "cancelled");
  attempt not expired; code redeemed with PKCE, state and nonce (signature, `iss`, `aud`, `exp` via
  openid-client); `acr` is in the accepted list; `auth_time` falls inside this attempt; `(iss, sub)` matches
  the linked account or isn't linked elsewhere; the draft is still awaiting *this* attempt and its
  hash equals the snapshot. Only then does the comment post, with author type `agent`.
- Every failure discards the draft. Abandoned confirms expire on their own (lazy sweep). An agent
  can rewrite its draft at any time; a rewrite during a confirm makes that confirm fail
  (`draft_changed`).

## Setup

1. **IDKit app** — <https://developer.world.org>: create a **production** app and note `app_id`,
   `rp_id` and the signing key (shown once). Actions are created on the fly and bound by the RP
   signature, with `action_description` shown in World App.
2. **Agent Pass client** — <https://auth.world.org/portal>: register an OIDC client with redirect URI
   `https://localhost:3000/api/agent-pass/callback` (HTTPS, exact match). If the portal rejects
   localhost, use a tunnel (e.g. `cloudflared tunnel --url https://localhost:3000`) and set that
   origin in both `FRONTEND_ORIGIN` and `AGENT_PASS_REDIRECT_URI`.
3. `cp backend/.env.example backend/.env` and fill it in (`openssl rand -hex 32` for `SESSION_SECRET`).
4. Install and run:
   ```bash
   npm install
   npm run dev:backend      # http://localhost:4000
   npm run dev:frontend     # https://localhost:3000 (self-signed; /api proxied to the backend)
   npm test                 # 20 gate tests incl. every denied path
   ```

**Environment trap:** a production app/action only answers the real World App; staging only
answers the Simulator. A mismatch looks like a frontend bug. The backend rejects any proof whose
`environment` isn't `WORLD_ID_ENVIRONMENT` and says so (`wrong_environment`).

**Mocked-proof fallback:** not used. If real verification becomes a live-demo risk, the fallback is
`WORLD_ID_ENVIRONMENT=staging` + Simulator for IDKit and `AGENT_PASS_ISSUER=https://sandbox.auth.world.org`
for Agent Pass. The same code paths run and only the issuers change. If we fall back, the demo must
say so: sandbox identities are not real humans.

## Demo script (every path the World tracks require)

1. **Join** — `/join`, pick `maya`, *Verify with World ID to join* → scan with World App → "You're in —
   maya.commentdesk.eth". *Alternative path:* verify again with another handle → "Welcome back", no second name.
2. **Human comment** — `/dockets/truck-emissions-rule`, *I'll write it myself*, type, *Verify with World ID & post* → posted, badge "Human-typed".
   - *Denied (cancel):* start again and cancel in World App → "You cancelled… Nothing was posted."
   - *Denied (nullifier reuse):* comment again on the same topic → "You've already commented on this topic."
3. **Agent comment** — `/agent` → *Issue agent token* → run the shown `npm run agent … draft` command.
   On the docket page, *My agent drafted it* shows the draft with its hash → *Approve with World ID
   Agent Pass* → World IdP fresh login → back on the docket: "Approved… posted", badge "Agent-drafted · human-approved".
   - *Denied (draft changed):* new draft → click approve → while World is asking, run `npm run agent … edit` →
     finish the approval → "The draft changed after approval was requested. It was discarded — nothing posted."
   - *Denied (cancel/expiry):* cancel at World, or wait out the countdown (set `AGENT_PASS_CONFIRM_TTL_SECONDS=30` for the demo) → discarded.
