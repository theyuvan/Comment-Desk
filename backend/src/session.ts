import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";

/** Member session, issued only after a server-validated join proof. */
const COOKIE = "cd_session";
const MAX_AGE_SECONDS = 7 * 24 * 3600;

export class Sessions {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly secure: boolean,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(res: Response, memberRef: string) {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(memberRef)
      .setIssuedAt()
      .setExpirationTime(`${MAX_AGE_SECONDS}s`)
      .sign(this.key);
    res.cookie(COOKIE, jwt, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.secure,
      path: "/",
      maxAge: MAX_AGE_SECONDS * 1000,
    });
  }

  clear(res: Response) {
    res.clearCookie(COOKIE, { path: "/" });
  }

  async memberRef(req: Request): Promise<string | null> {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw) return null;
    try {
      const { payload } = await jwtVerify(raw, this.key, { algorithms: ["HS256"] });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
