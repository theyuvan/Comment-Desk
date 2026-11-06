# Best Use of IDKit

## How we use it

IDKit 4 gates two moments, both with a server-chosen, server-signed request the client can only
carry, never author:

| Moment | Credential | Why this credential, not more or less |
| --- | --- | --- |
| **Join** | Proof of Human (default), or Selfie Check via `WORLD_ID_JOIN_CREDENTIAL` | The registry rests on "one human, one name." That's a uniqueness question — Proof of Human is the credential built for it. A passport or NFC credential would prove nationality and document data we don't need and must never store. |
| **Human-typed comment** | Follows the docket: **strict → Proof of Human**, **soft → Selfie Check** | Typing the comment *is* the human review already, so one uniqueness proof at submit time is proportionate — not an extra identity document for every post. |

The signal is never just "yes, a human." For a comment it binds the member and
`sha256(docket, topic, position, text)`, so a proof can't be replayed for different words, and the
action is scoped per `(docket, topic)`, so the nullifier itself means "already commented here" —
reusing it is a server-side `nullifier_reused` refusal, not a client-side check.

**Code reference:** [`backend/src/world/idkit.ts:173`](../backend/src/world/idkit.ts#L173),
`verifyWorldResult` — the backend chooses `action`/`signal`/credential, signs the request, and on
verify checks the request is unused and unexpired, the session matches, the environment matches,
the protocol is 4.0, the credential identifier matches, `signal_hash == hashSignal(signal)`, and
finally calls `POST developer.world.org/api/v4/verify/{rp_id}` itself — the client's own claim of
success is never trusted.

## Successful and alternative paths, demonstrated

- **Successful:** join mints `maya.commentdesk.eth`; a human comment posts as that name. Full
  script in [`docs/world-id.md`](../docs/world-id.md#demo-script-every-path-the-world-tracks-require).
- **Cancelled:** the member cancels the widget in World App — "You cancelled… Nothing was posted."
- **Already verified (join):** verifying again with the same nullifier signs the human back into
  their existing member instead of minting a second name — reused, not rejected, because the
  identity is already known.
- **Reused on a comment:** commenting twice on one topic is refused, `nullifier_reused`, with the
  proof's nullifier never burned on a refusal the desk itself issues (so a legitimate retry still
  works).

## Integration debrief

**Time to first success:** TODO (live) — request signing, result validation and the portal call
are implemented and unit-tested; building them took about an hour once we found that the README's
"device-level" credential had been superseded by IDKit 4's Proof of Human/Selfie Check model. The
real-World-App number can only be filled after the first production scan, which needs a phone.

**Friction:**
- IDKit 2's `IDKitWidget`/`verifyCloudProof` API is gone in 4.x, and a fair amount of existing
  write-ups online still reference it — we built against the current SDK's actual exports, not the
  older examples that still rank well in search.
- `deviceLegacy` is marked deprecated and only returns World ID 3.0 proofs, which don't establish
  the uniqueness our join step actually needs — the docs don't flag this loudly enough for someone
  reaching for "device-level" verification by habit.

**Missing capability / docs:** no documented guidance on binding a *position*, not just free text,
into the signal for an app where the position (support/oppose/neutral) is itself the thing being
counted — we derived our own convention (`sha256(docket, topic, position, text)`).

**One improvement with the greatest impact:** a worked example in the docs of signal composition
for structured, multi-field actions (not just "prove you're human for this one string"), since
that's the actual integration work for any app that counts something more than a login.
