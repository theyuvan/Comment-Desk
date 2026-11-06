"use client";

import { useSearchParams } from "next/navigation";
import { explain } from "./reasons";

/** Shows what came back from the Agent Pass callback (`?agentpass=posted|denied&reason=`). */
export function AgentPassResult() {
  const params = useSearchParams();
  const status = params.get("agentpass");
  if (!status) return null;
  if (status === "posted") {
    return <p className="banner ok">Approved with World ID Agent Pass â€” your agent&apos;s draft was posted, flagged as agent-authored.</p>;
  }
  return (
    <p className="banner denied" role="alert">
      Agent Pass denied: {explain(params.get("reason") ?? "unknown")}
    </p>
  );
}
