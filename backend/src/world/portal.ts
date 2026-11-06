/**
 * Server-side proof verification against World's Developer Portal (IDKit 4).
 * The IDKit result is forwarded as-is; the portal checks the ZK proof.
 */
export interface PortalVerdict {
  success: boolean;
  environment?: string;
  code?: string;
  detail?: string;
}

export interface PortalVerifier {
  verify(idkitResult: unknown): Promise<PortalVerdict>;
}

export function createPortalVerifier(opts: { base: string; rpId: string }, fetchImpl: typeof fetch = fetch): PortalVerifier {
  const url = `${opts.base.replace(/\/$/, "")}/api/v4/verify/${encodeURIComponent(opts.rpId)}`;
  return {
    async verify(idkitResult) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(idkitResult),
      });
      const body = (await res.json().catch(() => ({}))) as PortalVerdict;
      return { ...body, success: res.ok && body.success === true };
    },
  };
}
