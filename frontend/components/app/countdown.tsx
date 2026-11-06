"use client"

import { useEffect, useState } from "react"

function remaining(milliseconds: number) {
  const minutes = Math.ceil(milliseconds / 60_000)
  if (minutes < 2) return `${Math.max(0, Math.ceil(milliseconds / 1000))} seconds left`
  if (minutes < 120) return `${minutes} minutes left`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hours left`
  return `${Math.round(hours / 24)} days left`
}

/** Time left until `to`, in milliseconds since the epoch. Calls onEnd once at zero. */
export function Countdown({ to, onEnd }: { to: string; onEnd?: () => void }) {
  const [now, setNow] = useState<number>()

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const left = now === undefined ? undefined : Number(to) - now
  useEffect(() => {
    if (left !== undefined && left <= 0) onEnd?.()
    // Only the moment it reaches zero matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left !== undefined && left <= 0])

  if (left === undefined) return null
  return <span>{left > 0 ? remaining(left) : "Deadline reached"}</span>
}
