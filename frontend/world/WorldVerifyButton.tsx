"use client"

import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, ApiFailure } from "./api"
import { explain } from "./reasons"

export type WorldRequestInput =
  | { purpose: "join"; handle: string; wallet?: string }
  | { purpose: "comment"; docketKey: string; topic: string; text: string; sentiment?: string }

type WorldRequestDto = {
  action_description: string
  credential: "proof_of_human" | "selfie"
  rp_context: { nonce: string }
}

/**
 * STAND-IN. The World branch's frontend/src/world/WorldVerifyButton.tsx replaces
 * this file: it has the same name and the same props, so no screen changes.
 *
 * This version runs the same request and verify calls, and shows a dialog where
 * World App would ask for a proof. It proves nothing, and the backend marks the
 * result "dev:".
 */
export function WorldVerifyButton<T>({
  input,
  verifyPath,
  label,
  disabled,
  onVerified,
}: {
  input: WorldRequestInput
  verifyPath: "/api/world/verify/join" | "/api/world/verify/comment"
  label: string
  disabled?: boolean
  onVerified: (result: T) => void
}) {
  const [request, setRequest] = useState<WorldRequestDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<string | null>(null)
  const approving = useRef(false)

  const describe = (error: unknown) => (error instanceof ApiFailure ? explain(error.reason, error.message) : String(error))

  async function begin() {
    setDenied(null)
    setBusy(true)
    try {
      setRequest(await api<WorldRequestDto>("/api/world/requests", { body: input }))
    } catch (error) {
      setDenied(describe(error))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!request || approving.current) return
    approving.current = true
    setBusy(true)
    try {
      const subject = input.purpose === "join" ? input.wallet : undefined
      const result = await api<T>(verifyPath, { body: { result: { nonce: request.rp_context.nonce, subject } } })
      setRequest(null)
      onVerified(result)
    } catch (error) {
      setRequest(null)
      setDenied(describe(error))
    } finally {
      approving.current = false
      setBusy(false)
    }
  }

  function cancel() {
    setRequest(null)
    setDenied(explain("cancelled"))
  }

  return (
    <div className="world-verify">
      <button type="button" className="btn btn-world" onClick={begin} disabled={disabled || busy}>
        {busy && !request ? "Preparing…" : label}
      </button>
      {denied && (
        <p className="denied" role="alert">
          {denied}
        </p>
      )}
      <Dialog open={Boolean(request)} onOpenChange={(open) => !open && cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>World ID</DialogTitle>
            <DialogDescription>{request?.action_description}</DialogDescription>
          </DialogHeader>
          <p className="hint">
            Development stand-in. World App opens here once the real gate is connected, so nothing is verified yet and
            this record will be labelled as unverified.
          </p>
          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-world" onClick={approve} disabled={busy}>
              {busy ? "Verifying…" : "Approve"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
