// Auth is Void's: Better Auth, serving /api/auth/*, with tables Void generates
// (`pnpm db:generate`). Deployed, Cloudflare Access signs people in: the
// plugin in lib/cloudflare-access-plugin.ts turns Access's token into the
// session and turns the password endpoints off (lib/cloudflare-access.ts).
// Locally and in dev, email and
// password. No organizations: sharing is vibe's own (private, teams,
// everyone; lib/apps.ts), keyed on the user's email. Better Auth's admin
// plugin gives users a role; "admin" is vibe's super admin (lib/admin.ts).
import { admin } from "better-auth/plugins"
import { cloudflareAccess } from "./lib/cloudflare-access-plugin.ts"
import { defineAuth } from "void/auth"
import { accessOptions } from "./lib/cloudflare-access.ts"

export default defineAuth(({ defaults }) => ({
  ...defaults,
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, database: { generateId: () => crypto.randomUUID() } },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] }), cloudflareAccess(accessOptions)],
}))
