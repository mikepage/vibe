// Cloudflare Access as the sign-in (lib/cloudflare-access-plugin.ts): on when
// env.ts's CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set.
// Access's token becomes the Better Auth session, the password endpoints are
// off, and middleware/00.cloudflare-access.ts refuses every request without a
// token. Unset (local dev): email and password.
import { accessEnabled, CF_ACCESS_LOGOUT_PATH, type CloudflareAccessOptions } from "./cloudflare-access-plugin.ts"
import { env } from "void/env"

export const accessOptions: CloudflareAccessOptions = {
  teamDomain: () => env.CF_ACCESS_TEAM_DOMAIN,
  audience: () => env.CF_ACCESS_AUD,
  certsUrl: () => env.CF_ACCESS_CERTS_URL,
}

/** Whether Access signs people in, per request. */
export const viaAccess = () => accessEnabled(accessOptions)

/** Where signing out goes: Access's logout (or it signs you straight back in), else the sign-in page. */
export const signOutPath = () => (viaAccess() ? CF_ACCESS_LOGOUT_PATH : "/sign-in")
