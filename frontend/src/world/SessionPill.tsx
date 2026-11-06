"use client";
import Link from "next/link";

import { api } from "./api";
import { useSession } from "./useSession";

export function SessionPill() {
  const { session, refresh } = useSession();
  if (session === undefined) return <span className="pill" />;
  if (!session) {
    return <Link className="pill" href="/join">Not joined</Link>;
  }
  return (
    <span className="pill pill-member" title={session.worldLinked ? "World ID Agent Pass account linked" : undefined}>
      {session.ensName}
      <button
        className="link"
        onClick={async () => {
          await api("/api/session/logout", { body: {} });
          await refresh();
        }}
      >
        sign out
      </button>
    </span>
  );
}
