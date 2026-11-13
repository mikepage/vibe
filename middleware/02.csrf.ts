// The API changes state only for JSON requests from the platform's own pages. A form or
// a page on another origin (including an app's sandboxed page) can't send JSON without a
// CORS preflight, which the platform never answers.

import { defineMiddleware } from "void";

export default defineMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith("/api/") || path.startsWith("/api/auth/") || ["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  if (!c.req.header("content-type")?.startsWith("application/json")) return c.text("Send JSON.", 415);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.text("Cross-origin request refused.", 403);
  return next();
});
