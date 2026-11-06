import Link from "next/link";
import { Suspense } from "react";
import { AgentPassResult } from "@/world/AgentPassResult";

const DEMO_DOCKETS = [
  { key: "truck-emissions-rule", title: "Proposed heavy-duty truck emissions rule", level: "strict" },
  { key: "community-garden-hours", title: "Should the community garden open on weekday evenings?", level: "soft" },
];

export default function Home() {
  return (
    <>
      <Suspense>
        <AgentPassResult />
      </Suspense>
      <h1>Open dockets</h1>
      <p className="lede">
        Every comment here comes from one verified, unique human. Typed it yourself? One World ID check. Your agent
        drafted it? You approve that exact text with a fresh World ID Agent Pass confirm before it posts.
      </p>
      <ul className="dockets">
        {DEMO_DOCKETS.map((d) => (
          <li key={d.key}>
            <Link href={`/dockets/${d.key}`}>{d.title}</Link>
            <span className={`badge badge-${d.level}`}>{d.level === "strict" ? "Proof of Human" : "Selfie Check (soft)"}</span>
          </li>
        ))}
      </ul>
      <p className="hint">Demo dockets come from the stub host until the Arkiv docket layer lands.</p>
    </>
  );
}
