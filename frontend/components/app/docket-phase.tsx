import type { Docket, Phase } from "@/lib/api"

const LABELS: Record<Phase, string> = {
  open: "Open",
  "awaiting-ruling": "Awaiting ruling",
  closed: "Closed",
  "closed-for-cause": "Closed for cause",
}

export const formatDate = (millis: string) =>
  new Date(Number(millis)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function DocketPhase({ docket }: { docket: Docket }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {LABELS[docket.phase]} · {docket.phase === "open" ? "closes" : "closed"} {formatDate(docket.closedAt ?? docket.deadline)}
    </span>
  )
}

export function CredentialLabel({ docket }: { docket: Docket }) {
  return docket.credentialLevel === "proof_of_human" ? (
    <span className="font-mono text-xs">Strict: Proof of Human</span>
  ) : (
    <span className="font-mono text-xs text-muted-foreground">Soft: Proof of Presence</span>
  )
}
