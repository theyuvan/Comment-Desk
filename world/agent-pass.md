# World ID Agent Pass

## How we use it

An AI agent can draft a comment for a member, but it never posts one. Posting needs a fresh World
ID Agent Pass approval of that *exact* draft — a real OIDC step-up against `auth.world.org`, not a
login screen bolted onto an existing button:

- `max_age=0`, `prompt=login` — the IdP must re-authenticate the member right now, not reuse an
  old session.
- An essential `acr` claim (Orb by default, `AGENT_PASS_ACR_VALUES`) — the approver must hold the
  credential level the docket requires.
- The OIDC **nonce is frozen to the draft's hash** (`sha256(draftHash ‖ salt)`) before the redirect,
  so the World-signed ID token itself commits to the approved text and position — there is no
  separate "approve" step that could be pointed at different words later.

**Code reference:** [`backend/src/world/agent-pass.ts:25`](../backend/src/world/agent-pass.ts#L25)
(`startAgentConfirm`, the frozen nonce) and
[`backend/src/world/agent-pass.ts:81`](../backend/src/world/agent-pass.ts#L81)
(`completeAgentConfirm`, every check before anything posts: known single-use state, matching
session, no IdP error, attempt not expired, PKCE/state/nonce verified via `openid-client`,
`acr` in the accepted list, `auth_time` inside this attempt, `(iss, sub)` matches the linked
account, and the draft's hash still equals the snapshot taken at start).

The protected action is never exposed to the client: the comment only posts from the backend,
after the callback above fully validates, with author type `agent` and the record
`"agent drafted · human approved"` written to ENS alongside it — a meaningful action, not a login
screen.

## Successful and alternative paths, demonstrated

- **Successful:** agent drafts, member approves, comment posts as
  `agent.maya.commentdesk.eth`. Full script in
  [`docs/world-id.md`](../docs/world-id.md#demo-script-every-path-the-world-tracks-require).
- **Denied — draft changed:** the agent revises the draft while an approval is in flight. The
  callback's hash check fails and the draft is discarded: *"The draft changed after approval was
  requested. It was discarded — nothing posted."*
- **Denied — cancelled or expired:** the member cancels at World, or the confirm TTL
  (`AGENT_PASS_CONFIRM_TTL_SECONDS`) runs out. Every failure path discards the draft; abandoned
  confirms expire on their own via a lazy sweep, with nothing left pending.

## Integration debrief

**Time to first success:** TODO (live) — from reading the docs to a correctly formed step-up
request reaching `https://auth.world.org` (discovery OK, `/api/v1/authorize` reached): about an
hour. The gate logic and every denied path above pass in tests against a fake IdP; the real number
can only be filled after the first production approval, which needs a phone.

**Friction:**
- Agent Pass is a standard OIDC step-up, not an SDK, which is good — but the name made us look for
  a package first. The docs only clarify this once you reach the step-up guide itself.
- Production discovery advertises only `orb` and `orb-face` `acr` values, so every approver needs
  an Orb credential — a Selfie-level human checkpoint isn't available for this flow in production,
  which narrowed our "soft" docket design more than we expected.
- Redirect URIs must be HTTPS and match exactly, and the registration guide doesn't say whether
  `https://localhost` is accepted — local development may need a tunnel to find out.

**Missing capability / docs:** no way to bind the *content being approved* into the IdP's own
consent screen or token (no binding message, no `authorization_details`, no request objects). We
work around it by deriving the OIDC nonce from the draft hash, so the signed token commits to the
text — but the human still can't see the text on World's own screen during approval.

**One improvement with the greatest impact:** a binding/approval message (RAR
`authorization_details`, or a CIBA-style binding message) shown in World App and echoed back as a
signed claim. "Approve this exact agent action" would then be a first-class, auditable claim
World itself makes, instead of an app-side convention like ours.
