"use client";

import { useRef, useState } from "react";
import { IDKitRequestWidget, IDKitErrorCodes, proofOfHuman, selfieCheck, type IDKitResult } from "@worldcoin/idkit";
import type { WorldRequestDto, WorldRequestInput } from "@commentdesk/shared";
import { api, ApiFailure } from "./api";
import { explain } from "./reasons";

const CREDENTIAL_LABEL = { proof_of_human: "Proof of Human (Orb)", selfie: "Selfie Check" } as const;

/**
 * One World ID (IDKit 4) check. The backend issues the request — action, signal,
 * credential and a signed rp_context — and validates the result. This component only
 * carries the proof between World App and the backend; it never decides anything.
 */
export function WorldVerifyButton<T>({
  input,
  verifyPath,
  label,
  disabled,
  onVerified,
}: {
  input: WorldRequestInput;
  verifyPath: "/api/world/verify/join" | "/api/world/verify/comment";
  label: string;
  disabled?: boolean;
  onVerified: (result: T) => void;
}) {
  const [request, setRequest] = useState<WorldRequestDto | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const verified = useRef<{ value: T } | null>(null);

  async function begin() {
    setDenied(null);
    setBusy(true);
    try {
      // Fresh request every time: each rp_context nonce is single-use.
      setRequest(await api<WorldRequestDto>("/api/world/requests", { body: input }));
      setOpen(true);
    } catch (err) {
      setDenied(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(result: IDKitResult) {
    try {
      verified.current = { value: await api<T>(verifyPath, { body: { result } }) };
    } catch (err) {
      setDenied(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
      throw err; // tells the widget the host rejected it
    }
  }

  function onError(code: IDKitErrorCodes) {
    setRequest(null);
    setDenied((prev) =>
      prev ?? (code === IDKitErrorCodes.Cancelled || code === IDKitErrorCodes.UserRejected
        ? explain("cancelled")
        : explain(code, `World ID check failed (${code}).`)),
    );
  }

  return (
    <div className="world-verify">
      <button className="btn btn-world" onClick={begin} disabled={disabled || busy || open}>
        {busy ? "Preparing…" : label}
      </button>
      {request && (
        <p className="hint">
          Requires <strong>{CREDENTIAL_LABEL[request.credential]}</strong> via World App ({request.environment}).
        </p>
      )}
      {denied && <p className="denied" role="alert">{denied}</p>}
      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setRequest(null);
          }}
          app_id={request.app_id}
          action={request.action}
          action_description={request.action_description}
          rp_context={request.rp_context}
          environment={request.environment}
          allow_legacy_proofs={request.allow_legacy_proofs}
          require_user_presence={request.require_user_presence}
          preset={
            request.credential === "selfie"
              ? selfieCheck({ signal: request.signal })
              : proofOfHuman({ signal: request.signal })
          }
          handleVerify={handleVerify}
          onSuccess={() => {
            setRequest(null);
            if (verified.current) onVerified(verified.current.value);
            verified.current = null;
          }}
          onError={onError}
        />
      )}
    </div>
  );
}
