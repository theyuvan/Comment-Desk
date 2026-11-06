import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Pitch · Comment Desk",
  description:
    "Comment Desk in seven slides: public input from real, unique humans, with a record anyone can recount.",
}

export default function PitchLayout({ children }: { children: ReactNode }) {
  return children
}
