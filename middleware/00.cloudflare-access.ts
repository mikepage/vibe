// Behind Cloudflare Access (lib/cloudflare-access.ts), every request needs a
// valid Access token: pages, the API, auth and Void's own endpoints, with no
// exempt paths. A request without one didn't come through Access (a
// misrouted hostname) or came with a service token, which names no user;
// either way, a 401. auth.ts's plugin has already turned a good token into
// the session.
//
// One exception: calls from a running app's VIBE binding. Those arrive
// through ctx.exports with props the platform set ({ appId, userEmail }); no
// request from outside can carry props, and routes/internal/data.ts is the
// only thing that accepts them.
import { CF_ACCESS_HEADER, CLOUDFLARE_ACCESS_ERRORS, verifyAccessToken } from "../lib/cloudflare-access-plugin.ts"
import { defineMiddleware } from "void"
import { accessOptions, viaAccess } from "../lib/cloudflare-access.ts"
import { appProps } from "../lib/props.ts"

const { code, message } = CLOUDFLARE_ACCESS_ERRORS.ACCESS_REQUIRED

export default defineMiddleware(async (c, next) => {
  if (appProps(c) || !viaAccess() || (await verifyAccessToken(c.req.header(CF_ACCESS_HEADER), accessOptions))) return next()
  const headers = { "cache-control": "no-store" }
  if (c.req.path.startsWith("/api/")) return Response.json({ error: message, code }, { status: 401, headers })
  return new Response(`${message}\n`, { status: 401, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } })
})
