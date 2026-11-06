import type { Docket, Phase } from "@/lib/api"

const LABELS: Record<Phase, string> = {
  open: "Open",
  "awaiting-ruling": "Awaiting ruling",
  closed: "Concluded",
  "closed-for-cause": "Closed for cause",
}

export const formatDate = (millis: string) =>
  new Date(Number(millis)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function DocketPhase({ docket }: { docket: Docket }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {LABELS[docket.phase]} · {docket.phase === "open" ? "closes" : docket.closedAt ? "closed" : "closed to comments"}{" "}
      {formatDate(docket.closedAt ?? docket.deadline)}
    </span>
  )
}

export function CredentialLabel({ docket }: { docket: Docket }) {
  // Early test dockets stored the older level names.
  const strict = docket.credentialLevel === "strict" || (docket.credentialLevel as string) === "proof_of_human"
  return strict ? (
    <span className="font-mono text-xs">Strict: Proof of Human (Orb)</span>
  ) : (
    <span className="font-mono text-xs text-muted-foreground">Soft: Selfie Check</span>
  )
}
