"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionDto } from "@commentdesk/shared";
import { api } from "./api";

export function useSession() {
  const [session, setSession] = useState<SessionDto | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    setSession(await api<SessionDto | null>("/api/session").catch(() => null));
  }, []);
  useEffect(() => {
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refresh]);
  return { session, refresh };
}
