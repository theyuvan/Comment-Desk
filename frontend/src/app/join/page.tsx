"use client";
import Link from "next/link";

import { useState } from "react";
import type { MemberCreated } from "@commentdesk/shared";
import { JoinWithWorldId } from "@/world/JoinWithWorldId";

export default function JoinPage() {
  const [member, setMember] = useState<(MemberCreated & { returning: boolean }) | null>(null);
  return (
    <>
      <h1>Join Comment Desk</h1>
      {member ? (
        <div className="card">
          <p className="ok">
            {member.returning ? "Welcome back" : "You're in"} — <strong>{member.ensName}</strong>
          </p>
          <p className="hint">
            {member.returning
              ? "This World ID already has a name here, so you were signed back in instead of getting a second one."
              : "One World ID, one name. Head to a docket to comment."}
          </p>
          <Link className="btn" href="/">Browse dockets</Link>
        </div>
      ) : (
        <JoinWithWorldId onJoined={setMember} />
      )}
    </>
  );
}
