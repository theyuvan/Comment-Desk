# Integration debriefs — World ID Agent Pass and IDKit

Written from the build so far. Fields marked **TODO (live)** can only be filled after the first
real proof through production World App and World IdP. Fill them in then; don't guess.

## World ID Agent Pass

- **Time to first success:** TODO (live). From reading the docs to a correctly formed step-up
  request against `https://auth.world.org` (discovery OK, `/api/v1/authorize` reached): about an hour.
  The gate logic and all its denied paths pass in tests against a fake IdP.
- **Friction:**
  - Agent Pass is a standard OIDC step-up, not an SDK. That's good, but the name made us look for
    a package first. The docs show this only once you reach the step-up guide.
  - Production discovery advertises only `orb` and `orb-face` acr values, so every approver needs
    an Orb credential. A Selfie-level human checkpoint isn't available in production.
  - Redirect URIs must be HTTPS and match exactly. The registration guide doesn't say whether
    `https://localhost` is accepted, so local development may need a tunnel.
- **Missing capability / docs:** no way to bind the *content being approved* into the IdP's
  consent screen or token (no binding message, no `authorization_details`, no request objects).
  We work around it by deriving the OIDC nonce from the draft hash, so the signed token commits to
  the text. The human still can't see the text on World's own screen.
- **One improvement with the greatest impact:** a binding/approval message (RAR
  `authorization_details` or a CIBA-style binding message) shown in World App and echoed as a
  signed claim. "Approve this exact agent action" would then be a first-class, auditable claim,
  instead of an app-side convention.

## IDKit (Best Use of IDKit)

- **Time to first success:** TODO (live). Request signing, result validation and the portal call
  are implemented and unit-tested. Building them took about an hour once we found that the README's
  `IDKitWidget` / `verifyCloudProof` snippets no longer match IDKit 4.6.
- **Friction:**
  - The IDKit 3 → 4 change (RP-signed `rp_context`, `IDKitRequestWidget`, `/api/v4/verify/{rp_id}`,
    presets) broke every older tutorial snippet, including our own spec.
  - The docs say the backend "should enforce" the signal, but not how. You compare
    `responses[].signal_hash` to `hashSignal(signal)` yourself; the portal doesn't tell you.
  - `deviceLegacy` is deprecated, so "no Orb needed" now means Selfie Check, which has its own
    eligibility. Choosing the minimum credential took reading type definitions, not docs.
- **Missing capability / docs:** the `/v4/verify` response schema (per-credential `results`,
  codes) and the meaning/scale of Selfie Check's `sybil_score` aren't documented enough to set a
  threshold, so we don't threshold on it yet.
- **One improvement with the greatest impact:** an optional `expected_signal` (or
  `expected_signal_hash`) field on `/v4/verify`, so the portal itself rejects proofs bound to
  different content. That's the check every integrator has to remember and is easiest to forget.
