/** Why a World gate said no, in words a member understands. Keys are backend `reason` codes. */
const REASONS: Record<string, string> = {
  // IDKit / human path
  user_rejected: "You declined in World App. Nothing was posted.",
  cancelled: "You cancelled the World ID check. Nothing was posted.",
  verification_rejected: "World App rejected the verification.",
  credential_unavailable: "Your World ID doesn't hold the credential this action needs.",
  nullifier_reused: "You've already commented on this topic. One counted comment per human per topic.",
  nullifier_replayed: "You've already used World ID for this exact action.",
  max_verifications_reached: "You've already used World ID for this exact action.",
  already_commented: "You've already commented on this topic. One counted comment per human per topic.",
  signal_mismatch: "The proof was bound to different words than the ones being posted.",
  request_expired: "The verification took too long and expired. Start again.",
  request_replayed: "That verification was already used. Start again.",
  wrong_environment: "That proof came from a different World ID environment (Simulator vs. World App).",
  credential_mismatch: "This docket needs a different World ID credential than the one you proved.",
  proof_invalid: "World ID couldn't validate the proof.",
  presence_failed: "World App didn't complete the presence check.",
  not_a_member: "Join Comment Desk first.",
  docket_closed: "This docket is closed to new comments.",
  // Agent Pass / agent path
  confirm_expired: "The approval window closed before you finished. The agent's draft was discarded.",
  draft_changed: "The draft changed after approval was requested. It was discarded — nothing posted.",
  draft_expired: "The agent's draft expired before anyone approved it.",
  rejected_by_member: "You rejected this draft.",
  not_fresh: "World ID didn't do a fresh check for this approval.",
  acr_insufficient: "World ID authenticated you at a lower assurance than this action needs.",
  identity_mismatch: "A different World ID account approved this than the one linked to you.",
  identity_linked_elsewhere: "That World ID account is linked to another member.",
  confirm_replayed: "That approval was already used.",
  token_invalid: "World ID's response failed validation.",
  session_mismatch: "The approval came back to a different session than the one that started it.",
  invalid_sentiment: "Choose support, oppose or neutral.",
  // Built-in drafting agent
  agent_unavailable: "The built-in drafting agent isn't switched on here.",
  interview_expired: "That conversation timed out. Send your message again to start a new one.",
};

export function explain(reason: string, fallback?: string): string {
  return REASONS[reason] ?? fallback ?? `Blocked (${reason}).`;
}
