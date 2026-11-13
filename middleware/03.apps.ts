// /apps/<id> and everything under it goes to the app. A middleware rather than a route,
// because the router treats /apps/<id>/ (the app's root, with its trailing slash) as no match.
// vibe's script for app pages (lib/vibe-script.ts) is served here too.

import { defineMiddleware } from "void";
import { serveApp } from "../lib/serve.ts";
import { vibeScript, VIBE_SCRIPT_PATH } from "../lib/vibe-script.ts";

const APP_PATH = /^\/apps\/([a-z0-9-]+)(\/.*)?$/;

export default defineMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === VIBE_SCRIPT_PATH) return vibeScript();
  const match = APP_PATH.exec(path);
  if (!match) return next();
  return serveApp(c, match[1]);
});
