import { concat, keccak256, stringToBytes, stringToHex, toBytes, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { request } from "./api"

/**
 * The member's wallet is their passkey: Face ID, a fingerprint or Windows Hello.
 *
 * The WebAuthn PRF extension gives us a secret that only that passkey can
 * produce, and we derive the signing key from it. No key is ever saved, so
 * there is no seed phrase to back up and nothing at rest to steal, and a synced
 * passkey brings the same identity to a member's other devices. The key only
 * exists in memory while this tab is open.
 *
 * It signs messages and owns the member's ENS name. It never holds funds.
 *
 * A device without PRF falls back to a key kept in this browser, and the join
 * screen says so.
 */
const SESSION_KEY = "commentdesk.session"
const DEVICE_KEY = "commentdesk.key"
const PRF_SALT = toBytes(keccak256(stringToBytes("comment desk wallet v1")))

export type WalletKind = "passkey" | "device"

type PrfResults = { prf?: { results?: { first?: BufferSource }; enabled?: boolean } }

const toUint8 = (value: BufferSource) =>
  value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array((value as ArrayBufferView).buffer, (value as ArrayBufferView).byteOffset, (value as ArrayBufferView).byteLength)

/** Domain-separated, so this secret can never equal one derived for another purpose. */
const keyFromPrf = (secret: BufferSource) => keccak256(concat([stringToBytes("commentdesk:wallet:v1:"), toUint8(secret)]))

function remember(key: Hex, kind: WalletKind) {
  // Gone when the tab closes. A passkey wallet is re-derived, never restored from disk.
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ key, kind }))
}

/** The unlocked wallet, or null if the member needs to sign in. */
export function currentWallet() {
  const session = window.sessionStorage.getItem(SESSION_KEY)
  if (session) return privateKeyToAccount((JSON.parse(session) as { key: Hex }).key)
  const device = window.localStorage.getItem(DEVICE_KEY) as Hex | null
  return device ? privateKeyToAccount(device) : null
}

export function walletKind(): WalletKind | null {
  const session = window.sessionStorage.getItem(SESSION_KEY)
  if (session) return (JSON.parse(session) as { kind: WalletKind }).kind
  return window.localStorage.getItem(DEVICE_KEY) ? "device" : null
}

export function getWallet() {
  const wallet = currentWallet()
  if (!wallet) throw new Error("Sign in with your passkey first.")
  return wallet
}

export function signOut() {
  window.sessionStorage.removeItem(SESSION_KEY)
}

async function derive(credentialId?: BufferSource): Promise<Hex | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: "required",
      allowCredentials: credentialId ? [{ type: "public-key", id: credentialId }] : [],
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  const secret = (assertion?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first
  return secret ? keyFromPrf(secret) : null
}

/** Creates the passkey for a new member. `ensName` is what their device's prompt will show. */
export async function createWallet(ensName: string): Promise<WalletKind> {
  if (currentWallet()) return walletKind() ?? "device"
  if (window.PublicKeyCredential) {
    try {
      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: { name: "Comment Desk" },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: ensName, displayName: ensName },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null

      // Some authenticators only return the secret on a sign-in, not on creation.
      const prf = (credential?.getClientExtensionResults() as PrfResults | undefined)?.prf
      const key = prf?.results?.first ? keyFromPrf(prf.results.first) : prf?.enabled && credential ? await derive(credential.rawId) : null
      if (key) {
        remember(key, "passkey")
        return "passkey"
      }
    } catch (error) {
      // The member said no. Respect that: never fall back behind their back.
      if ((error as DOMException).name === "NotAllowedError") throw new Error("Passkey setup was cancelled.")
    }
  }
  const key = generatePrivateKey()
  window.localStorage.setItem(DEVICE_KEY, key)
  return "device"
}

/** Signs a returning member in. Works on any device their passkey has synced to. */
export async function unlockWallet() {
  let key: Hex | null
  try {
    key = await derive()
  } catch {
    throw new Error("Passkey sign-in was cancelled.")
  }
  if (!key) throw new Error("This passkey cannot derive a wallet on this device.")
  remember(key, "passkey")
  return privateKeyToAccount(key)
}

type TypedData = {
  domain: { name: string; version: string }
  types: Record<string, { name: string; type: string }[]>
  policyVersion: string
}

let schema: Promise<TypedData> | undefined
export function typedData() {
  schema ??= request<TypedData>("/api/typed-data")
  return schema
}

/** Signs one action. The server recovers the wallet from this, so there are no sessions. */
export async function signAction(primaryType: string, message: Record<string, unknown>) {
  const { domain, types } = await typedData()
  return getWallet().signTypedData({
    domain,
    types: { [primaryType]: types[primaryType]! },
    primaryType,
    message,
  })
}

export const textHash = (text: string) => keccak256(stringToHex(text))
