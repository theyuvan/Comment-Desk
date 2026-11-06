"use client";

import { useState } from "react";
import type { MemberCreated } from "@commentdesk/shared";
import { WorldVerifyButton } from "./WorldVerifyButton";

/** Join: one World ID proof → one member → one ENS name. Same human again signs back in. */
export function JoinWithWorldId({ onJoined }: { onJoined: (m: MemberCreated & { returning: boolean }) => void }) {
  const [handle, setHandle] = useState("");
  const valid = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(handle);

  return (
    <div className="card">
      <label className="field">
        <span>Choose your name</span>
        <span className="ens-input">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            placeholder="maya"
            maxLength={32}
            autoComplete="off"
          />
          <span>.commentdesk.eth</span>
        </span>
      </label>
      <p className="hint">
        World ID proves you&apos;re one unique human without revealing who you are. One human gets exactly one name
        here; verifying again later just signs you back in.
      </p>
      <WorldVerifyButton<MemberCreated & { returning: boolean }>
        input={{ purpose: "join", handle }}
        verifyPath="/api/world/verify/join"
        label="Verify with World ID to join"
        disabled={!valid}
        onVerified={onJoined}
      />
    </div>
  );
}
