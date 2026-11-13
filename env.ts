// Server values, set with `void secret put NAME=value`; locally from .env.
import { defineEnv, number, string, url } from "void/env"

export default defineEnv({
  // Generate with: openssl rand -base64 32
  BETTER_AUTH_SECRET: string(),

  /**
   * Sign-in through Cloudflare Access (lib/cloudflare-access-plugin.ts): the
   * Zero Trust team (`acme`, from acme.cloudflareaccess.com) and the Access application's Audience (AUD)
   * tag. With them set, Access's token is the sign-in and passwords are off;
   * unset (local dev), email and password. One without the other refuses everyone.
   */
  CF_ACCESS_TEAM_DOMAIN: string().optional(),
  CF_ACCESS_AUD: string().optional(),
  /** The team's keys, `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` unless set; the tests point it at a local fake. */
  CF_ACCESS_CERTS_URL: url().optional(),

  // Claude, through the Workers AI binding. Cloudflare model id, and the AI Gateway the
  // request runs through (`default` is created on first use). Paid with Unified Billing.
  AI_MODEL: string().default("anthropic/claude-opus-5.5"),
  AI_GATEWAY_ID: string().default("default"),

  // App data expires this long after a user's last write in an app. 14 days.
  DATA_TTL_SECONDS: number().default(1_209_600),
})
