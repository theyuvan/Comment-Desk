import { keccak256, stringToHex, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { request } from "./api"

const STORAGE_KEY = "commentdesk.key"

/**
 * The member's lightweight wallet. It is only the key behind their identity and
 * never holds funds, so members never have to manage a crypto wallet. It lives
 * in this browser: clearing site data loses the identity.
 */
export function getWallet() {
  let key = window.localStorage.getItem(STORAGE_KEY) as Hex | null
  if (!key) {
    key = generatePrivateKey()
    window.localStorage.setItem(STORAGE_KEY, key)
  }
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
