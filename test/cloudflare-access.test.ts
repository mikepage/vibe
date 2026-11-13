import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { admin } from "better-auth/plugins"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { accessIssuer, cloudflareAccess, resetAccessCache, verifyAccessToken, type CloudflareAccessOptions } from "../lib/cloudflare-access-plugin.ts"

// The Access plugin on its own (lib/cloudflare-access-plugin.ts), with Better Auth on
// a memory adapter: no Worker needed. A local stand-in for the team's JWKS: a key pair made here, its public half
// served from the certs URL by a fake fetch, tokens signed with the private half.
const TEAM = "acme"
const AUD = "aud-tag-123"
const ISSUER = "https://acme.cloudflareaccess.com"
const CERTS = `${ISSUER}/cdn-cgi/access/certs`
const options: CloudflareAccessOptions = { teamDomain: TEAM, audience: AUD }

const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
let signing: CryptoKeyPair
let stranger: CryptoKeyPair
let jwks: object

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const part = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)))

const now = () => Math.floor(Date.now() / 1000)
const sign = async (claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string; alg?: string } = {}) => {
  const head = part({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "key-1", typ: "JWT" })
  const body = part({ aud: [AUD], iss: ISSUER, sub: "sub-ann", email: "Ann@Example.com", iat: now(), nbf: now(), exp: now() + 600, type: "app", ...claims })
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? signing.privateKey, new TextEncoder().encode(`${head}.${body}`)))
  return `${head}.${body}.${b64url(signature)}`
}

beforeAll(async () => {
  signing = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair
  stranger = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey("jwk", signing.publicKey)) as JsonWebKey
  jwks = { keys: [{ ...jwk, kid: "key-1", alg: "RS256", use: "sig" }] }
})

let certs: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetAccessCache()
  const real = globalThis.fetch
  certs = vi.fn((input: RequestInfo | URL, init?: RequestInit) => (String(input) === CERTS ? Promise.resolve(Response.json(jwks)) : real(input, init)))
  vi.spyOn(globalThis, "fetch").mockImplementation(certs as typeof fetch)
})
afterEach(() => vi.restoreAllMocks())

describe("verifyAccessToken", () => {
  it("reads the email from a good token, lowercased", async () => {
    expect(await verifyAccessToken(await sign(), options)).toMatchObject({ email: "ann@example.com", sub: "sub-ann" })
  })

  it("takes the team as a name, a host or a URL", () => {
    expect(accessIssuer("acme")).toBe(ISSUER)
    expect(accessIssuer("acme.cloudflareaccess.com")).toBe(ISSUER)
    expect(accessIssuer("https://acme.cloudflareaccess.com/")).toBe(ISSUER)
  })

  it("refuses another audience, issuer, an expired or early token", async () => {
    expect(await verifyAccessToken(await sign({ aud: ["other"] }), options)).toBeNull()
    expect(await verifyAccessToken(await sign({ iss: "https://other.cloudflareaccess.com" }), options)).toBeNull()
    expect(await verifyAccessToken(await sign({ exp: now() - 120 }), options)).toBeNull()
    expect(await verifyAccessToken(await sign({ nbf: now() + 600 }), options)).toBeNull()
  })

  it("refuses another key's signature, another algorithm and garbage", async () => {
    expect(await verifyAccessToken(await sign({}, { key: stranger.privateKey }), options)).toBeNull()
    expect(await verifyAccessToken(await sign({}, { alg: "none" }), options)).toBeNull()
    const [head, , signature] = (await sign()).split(".")
    expect(await verifyAccessToken(`${head}.${part({ aud: [AUD], iss: ISSUER, email: "eve@example.com", exp: now() + 600 })}.${signature}`, options)).toBeNull()
    expect(await verifyAccessToken("not.a.token", options)).toBeNull()
  })

  it("leaves a service token, which has no email, signed out", async () => {
    expect(await verifyAccessToken(await sign({ email: undefined, common_name: "client.access" }), options)).toBeNull()
  })

  it("does nothing without a team and an audience", async () => {
    const token = await sign()
    expect(await verifyAccessToken(token, { teamDomain: TEAM, audience: "" })).toBeNull()
    expect(await verifyAccessToken(token, { teamDomain: undefined, audience: AUD })).toBeNull()
    expect(certs).not.toHaveBeenCalled()
  })

  it("fetches the keys once, and again for a kid it doesn't know", async () => {
    await verifyAccessToken(await sign({ sub: "a" }), options)
    await verifyAccessToken(await sign({ sub: "b" }), options)
    expect(certs).toHaveBeenCalledTimes(1)
    const later = Date.now() + 60_000
    vi.spyOn(Date, "now").mockReturnValue(later)
    expect(await verifyAccessToken(await sign({}, { kid: "key-2" }), options)).toBeNull()
    expect(certs).toHaveBeenCalledTimes(2)
  })

  it("is null when the keys can't be fetched", async () => {
    certs.mockResolvedValue(new Response("down", { status: 503 }))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await verifyAccessToken(await sign(), options)).toBeNull()
  })
})

const makeAuth = (access: CloudflareAccessOptions = options) =>
  betterAuth({
    baseURL: "https://crm.example",
    secret: "a-test-secret-that-is-long-enough-1234",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    plugins: [cloudflareAccess(access)],
  })

/** As Void's auth middleware asks: the session and the headers to send back. */
const session = (auth: ReturnType<typeof makeAuth>, headers: Record<string, string>) => auth.api.getSession({ headers: new Headers(headers), returnHeaders: true })
const cookieOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")

describe("cloudflareAccess", () => {
  it("makes the token's user and a session with its cookie", async () => {
    const auth = makeAuth()
    const { response, headers } = await session(auth, { "cf-access-jwt-assertion": await sign() })
    expect(response?.user).toMatchObject({ email: "ann@example.com", name: "ann", emailVerified: true })
    expect(response?.session.userId).toBe(response?.user.id)
    expect(cookieOf(headers)).toContain("better-auth.session_token=")
  })

  it("keeps one session for a client without cookies", async () => {
    const auth = makeAuth()
    const first = await session(auth, { "cf-access-jwt-assertion": await sign() })
    const second = await session(auth, { "cf-access-jwt-assertion": await sign({ iat: now() + 1 }) })
    expect(second.response?.session.id).toBe(first.response?.session.id)
  })

  it("uses the cookie's session when it is the token's user", async () => {
    const auth = makeAuth()
    const token = await sign()
    const first = await session(auth, { "cf-access-jwt-assertion": token })
    const again = await session(auth, { "cf-access-jwt-assertion": token, cookie: cookieOf(first.headers) })
    expect(again.response?.session.id).toBe(first.response?.session.id)
  })

  it("switches to the token's user when the cookie is someone else's", async () => {
    const auth = makeAuth()
    const ann = await session(auth, { "cf-access-jwt-assertion": await sign() })
    const bob = await session(auth, { "cf-access-jwt-assertion": await sign({ email: "bob@example.com", sub: "sub-bob" }), cookie: cookieOf(ann.headers) })
    expect(bob.response?.user.email).toBe("bob@example.com")
  })

  it("signs out a cookie without a token, or with a bad one", async () => {
    const auth = makeAuth()
    const ann = await session(auth, { "cf-access-jwt-assertion": await sign() })
    const cookie = cookieOf(ann.headers)
    expect((await session(auth, { cookie })).response).toBeNull()
    expect((await session(auth, { cookie, "cf-access-jwt-assertion": await sign({}, { key: stranger.privateKey }) })).response).toBeNull()
  })

  it("refuses password endpoints and requests without a token", async () => {
    const auth = makeAuth()
    const post = (path: string, headers: Record<string, string> = {}) =>
      auth.handler(new Request(`https://crm.example/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://crm.example", ...headers }, body: JSON.stringify({ email: "ann@example.com", password: "a-long-password", name: "Ann" }) }))
    const token = { "cf-access-jwt-assertion": await sign() }
    const signUp = await post("/sign-up/email", token)
    expect(signUp.status).toBe(403)
    expect(await signUp.json()).toMatchObject({ code: "ACCESS_PASSWORD_OFF" })
    expect((await post("/sign-in/email", token)).status).toBe(403)
    expect((await post("/request-password-reset", token)).status).toBe(403)
    const signOut = await post("/sign-out")
    expect(signOut.status).toBe(401)
    expect(await signOut.json()).toMatchObject({ code: "ACCESS_REQUIRED" })
    expect((await post("/sign-out", token)).status).toBe(200)
  })

  it("gives a new user the admin plugin's default role", async () => {
    const db: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] }
    const auth = betterAuth({
      baseURL: "https://crm.example",
      secret: "a-test-secret-that-is-long-enough-1234",
      database: memoryAdapter(db),
      plugins: [admin({ defaultRole: "member" }), cloudflareAccess(options)],
    })
    const { response } = await session(auth as unknown as ReturnType<typeof makeAuth>, { "cf-access-jwt-assertion": await sign() })
    expect(response?.user.email).toBe("ann@example.com")
    expect(db.user).toEqual([expect.objectContaining({ email: "ann@example.com", role: "member" })])
  })

  it("does nothing when Access isn't configured", async () => {
    const auth = makeAuth({ teamDomain: undefined, audience: undefined })
    expect((await session(auth, { "cf-access-jwt-assertion": await sign() })).response).toBeNull()
    const res = await auth.handler(
      new Request("https://crm.example/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "https://crm.example" }, body: JSON.stringify({ email: "pat@example.com", password: "a-long-password", name: "Pat" }) }),
    )
    expect(res.status).toBe(200)
    expect(certs).not.toHaveBeenCalled()
  })
})
