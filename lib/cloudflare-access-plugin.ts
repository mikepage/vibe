// Sign-in through Cloudflare Access, as a Better Auth plugin. The app sits
// behind an Access application, and the token Access puts on every
// request (`Cf-Access-Jwt-Assertion`) becomes a normal Better Auth session.
// Better Auth keeps everything else: users, roles, MCP OAuth.
//
//   plugins: [cloudflareAccess({ teamDomain: () => env.CF_ACCESS_TEAM_DOMAIN, audience: () => env.CF_ACCESS_AUD })]
//
// A Better Auth plugin, not Void middleware: Void's auth middleware reads the
// session through `auth.api.getSession` before the app's middleware runs, so
// the session is made in a `before` hook on /get-session. The hook verifies
// the token with WebCrypto (crypto.subtle: RS256 against the team's keys,
// then `aud`, `iss`, `exp`, `nbf`; no JWT library),
// finds the user by the token's email or creates one, and answers with their
// session: the newest live one, else a new one, with its cookie set. Reusing
// one keeps a cookie-less client (a CLI behind Access) from making a session
// per request. Service-token requests carry no email and stay signed out.
//
// Nothing bypasses Access. With it configured, a request without a valid
// token is signed out whatever cookie it has (the workers.dev URL and a
// misrouted hostname don't reach Access), Better Auth's endpoints refuse it,
// and password sign-in, sign-up and reset are off. Unset (local dev, tests),
// the plugin does nothing.
//
// A new user gets the admin plugin's `defaultRole` (or none without it):
// Access decides who gets in, the app what they may do.
// Stands alone: only Better Auth, nothing from Void. vibe's settings for it
// are in lib/cloudflare-access.ts.

import type { BetterAuthPlugin, Session, User } from "better-auth"
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"

/** The header Access sends the user's token in. */
export const CF_ACCESS_HEADER = "cf-access-jwt-assertion"

/** Where signing out of Access goes: Access ends its session and shows its own page. */
export const CF_ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout"

/** Off while Access signs people in: Better Auth's password endpoints, relative to its basePath. */
export const ACCESS_PASSWORD_ENDPOINTS = ["/sign-in/email", "/sign-in/magic-link", "/sign-up/email", "/request-password-reset", "/reset-password", "/change-password", "/set-password"]

export const CLOUDFLARE_ACCESS_ERRORS = {
  ACCESS_REQUIRED: { code: "ACCESS_REQUIRED", message: "Sign in through Cloudflare Access." },
  ACCESS_PASSWORD_OFF: { code: "ACCESS_PASSWORD_OFF", message: "Passwords are off: Cloudflare Access signs you in." },
} as const

type Value = string | null | undefined

export interface CloudflareAccessOptions {
  /** The Zero Trust team: `acme`, `acme.cloudflareaccess.com` or its URL. Unset or empty turns the plugin off. */
  teamDomain: Value | (() => Value)
  /** The Access application's Audience (AUD) tag. */
  audience: Value | (() => Value)
  /** Default `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; the tests point it elsewhere. */
  certsUrl?: Value | (() => Value)
  /** Better Auth paths refused while Access is on. Default {@link ACCESS_PASSWORD_ENDPOINTS}. */
  passwordEndpoints?: string[]
}

/** Who Access signed in, from a verified token. */
export interface AccessIdentity {
  /** Lowercased. */
  email: string
  /** Access's id for the user (`sub`). */
  sub: string
  /** Seconds since the epoch. */
  exp: number
}

const read = (value: Value | (() => Value)) => ((typeof value === "function" ? value() : value) ?? "").trim()

/** `https://<team>.cloudflareaccess.com` for any way of writing the team. */
export const accessIssuer = (teamDomain: string) => {
  const host = teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`
}

/** Whether Access is configured: a team domain or an audience set. One without the other refuses everyone. */
export const accessEnabled = (options: Pick<CloudflareAccessOptions, "teamDomain" | "audience">) => !!(read(options.teamDomain) || read(options.audience))

const decoder = new TextDecoder()
const base64url = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), (c) => c.charCodeAt(0))
const json = (part: string) => JSON.parse(decoder.decode(base64url(part))) as Record<string, unknown>

// The team's public keys by kid, per certs URL. Access rotates them every six
// weeks with an overlap; an unknown kid fetches again, at most every 30 seconds.
const KEYS_TTL = 60 * 60 * 1000
const REFETCH_AFTER = 30 * 1000
const keySets = new Map<string, { keys: Map<string, CryptoKey>; at: number }>()

const fetchKeys = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`certs ${res.status}`)
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
  const keys = new Map<string, CryptoKey>()
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]))
  }
  const set = { keys, at: Date.now() }
  keySets.set(url, set)
  return set
}

const keyFor = async (url: string, kid: string) => {
  let set = keySets.get(url)
  if (!set || Date.now() - set.at > KEYS_TTL) set = await fetchKeys(url)
  if (!set.keys.has(kid) && Date.now() - set.at > REFETCH_AFTER) set = await fetchKeys(url)
  return set.keys.get(kid)
}

// Tokens already verified, until they expire: Void's middleware and Better
// Auth's handler both read the same one per request.
const verified = new Map<string, AccessIdentity>()

/** Forget the cached keys and tokens (tests). */
export const resetAccessCache = () => {
  keySets.clear()
  verified.clear()
}

/**
 * Who a token says Access signed in, or null: a bad signature or
 * algorithm, another audience or issuer, expired, not yet valid, or without
 * an email (a service token). Keys that can't be fetched are null too.
 */
export const verifyAccessToken = async (token: string | null | undefined, options: Omit<CloudflareAccessOptions, "passwordEndpoints">): Promise<AccessIdentity | null> => {
  const team = read(options.teamDomain)
  const audience = read(options.audience)
  if (!token || !team || !audience) return null
  const now = Math.floor(Date.now() / 1000)
  const known = verified.get(token)
  if (known) {
    if (known.exp > now) return known
    verified.delete(token)
  }
  const issuer = accessIssuer(team)
  try {
    const [head, body, signature] = token.split(".")
    if (!head || !body || !signature) return null
    const header = json(head)
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null
    const key = await keyFor(read(options.certsUrl) || `${issuer}/cdn-cgi/access/certs`, header.kid)
    if (!key) return null
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(signature), new TextEncoder().encode(`${head}.${body}`)))) return null
    const claims = json(body)
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(audience) || claims.iss !== issuer) return null
    // A minute's leeway for clocks.
    if (typeof claims.exp !== "number" || claims.exp <= now - 60) return null
    if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return null
    const identity = { email: claims.email.toLowerCase(), sub: String(claims.sub ?? ""), exp: claims.exp }
    if (verified.size >= 500) verified.delete(verified.keys().next().value!)
    verified.set(token, identity)
    return identity
  } catch (e) {
    console.warn(JSON.stringify({ type: "cloudflare_access_verify_failed", error: e instanceof Error ? e.message : String(e) }))
    return null
  }
}

const refuse = (status: 401 | 403, error: (typeof CLOUDFLARE_ACCESS_ERRORS)[keyof typeof CLOUDFLARE_ACCESS_ERRORS]) => ({
  response: Response.json({ error: error.message, message: error.message, code: error.code }, { status }),
})

type Banned = User & { banned?: boolean | null; banExpires?: Date | string | null }
const isBanned = (user: Banned) => !!user.banned && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())

export const cloudflareAccess = (options: CloudflareAccessOptions) => {
  const passwordEndpoints = options.passwordEndpoints ?? ACCESS_PASSWORD_ENDPOINTS

  return {
    id: "cloudflare-access",
    $ERROR_CODES: CLOUDFLARE_ACCESS_ERRORS,
    // Requests Better Auth's handler serves (/api/auth/*).
    onRequest: async (request, ctx) => {
      if (!accessEnabled(options)) return
      const basePath = ctx.options.basePath ?? "/api/auth"
      const pathname = new URL(request.url).pathname
      const path = (pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname).replace(/\/+$/, "")
      if (passwordEndpoints.includes(path)) return refuse(403, CLOUDFLARE_ACCESS_ERRORS.ACCESS_PASSWORD_OFF)
      if (!(await verifyAccessToken(request.headers.get(CF_ACCESS_HEADER), options))) return refuse(401, CLOUDFLARE_ACCESS_ERRORS.ACCESS_REQUIRED)
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/get-session",
          handler: createAuthMiddleware(async (ctx) => {
            if (!accessEnabled(options)) return
            // Without a valid token, signed out: get-session runs without the cookie.
            const signedOut = { context: { headers: new Headers({ cookie: "" }) } }
            const identity = await verifyAccessToken(ctx.headers?.get(CF_ACCESS_HEADER), options)
            if (!identity) return signedOut

            const current = await getSessionFromCtx(ctx).catch(() => null)
            if (current?.user.email.toLowerCase() === identity.email) return

            const adapter = ctx.context.internalAdapter
            try {
              const found = await adapter.findUserByEmail(identity.email)
              const user = (found?.user ?? (await adapter.createUser({ email: identity.email, name: identity.email.split("@")[0]!, emailVerified: true }, { method: "cloudflare-access" }))) as Banned
              if (isBanned(user)) return signedOut
              const live = (await adapter.listSessions(user.id)).filter((s) => new Date(s.expiresAt).getTime() > Date.now()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
              const session: Session = live ?? (await adapter.createSession(user.id))
              await setSessionCookie(ctx, { session, user })
              return { session, user }
            } catch (e) {
              // A database hook refusing the session (Better Auth's admin plugin for a banned user).
              if (isAPIError(e)) return signedOut
              throw e
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
