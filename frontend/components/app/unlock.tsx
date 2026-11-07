"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { unlockWallet } from "@/lib/wallet"

/**
 * A passkey wallet lives only in memory, so a new tab or a restarted browser starts locked even
 * though the server session still knows who you are. Commenting works locked (World ID is the check);
 * opening a docket or publishing a ruling needs your signature, so those ask for this first.
 */
export function UnlockPasskey({ onUnlocked }: { onUnlocked: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function unlock() {
    setBusy(true)
    setError("")
    try {
      await unlockWallet()
      onUnlocked()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={unlock} disabled={busy} className="rounded-full">
        {busy ? "Waiting for your passkey…" : "Unlock with passkey"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
