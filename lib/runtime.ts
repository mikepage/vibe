// Runs apps as Dynamic Workers. Each (app, version, user) gets its own isolate, because
// the VIBE binding is fixed when the isolate loads: it carries the props
// { appId, userEmail }, and the app can't change them. So one user's isolate can never
// reach another user's data, and no in-memory state is shared between users either.

import type { Context } from "hono";
import type { Bundle } from "./build.ts";
import type { Outbound } from "./outbound.ts";
import { withTopBar } from "./topbar.ts";
import { VIBE_SCRIPT_PATH, withVibeScript } from "./vibe-script.ts";
import type { AppProps, OutboundProps } from "./props.ts";

export const APP_COMPATIBILITY_DATE = "2026-11-01";

type Exports = { default: (options: { props: AppProps | OutboundProps }) => Fetcher };

export async function userKey(email: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Starts (or reuses) the isolate for one user of one app version. */
export function loadApp(
  c: Context,
  opts: { isolateId: string; props: AppProps; outbound: Outbound; bundle: () => Promise<Bundle> },
): WorkerStub {
  const exports = (c.executionCtx as ExecutionContext & { exports: Exports }).exports;
  return (c.env.LOADER as WorkerLoader).get(opts.isolateId, async () => {
    const bundle = await opts.bundle();
    return {
      compatibilityDate: APP_COMPATIBILITY_DATE,
      mainModule: bundle.mainModule,
      modules: bundle.modules as WorkerLoaderModules,
      // The app's network setting (lib/outbound.ts). Disabled: no fetch() at all, and the
      // only way out is VIBE, back into the platform. Allow list: every fetch() goes to the
      // platform's gateway (middleware/00.app-outbound.ts). All: the internet.
      ...(opts.outbound.mode === "all"
        ? {}
        : { globalOutbound: opts.outbound.mode === "allowlist" ? exports.default({ props: { outboundFor: opts.props.appId, hosts: opts.outbound.hosts } }) : null }),
      env: { VIBE: exports.default({ props: opts.props }) },
    };
  });
}

type WorkerLoaderModules = Parameters<WorkerLoader["get"]>[1] extends (...a: never[]) => infer R
  ? Awaited<R> extends { modules: infer M }
    ? M
    : never
  : never;

// The only script an app page runs is vibe's own (lib/vibe-script.ts), allowed by its full
// URL: not 'self', which would let an app serve a script of its own from under /apps/.
const appCsp = (origin: string) =>
  [
    "default-src 'self'",
    `script-src ${origin}${VIBE_SCRIPT_PATH}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; ");

// Headers an app gets from the browser. Not cookies, not the Access token.
const FORWARD = ["accept", "accept-language", "content-type", "user-agent", "if-none-match", "if-modified-since"];

/**
 * Sends a browser request to an app mounted at `base` (like "/apps/todo-x1/"). `appName` is for
 * vibe's top bar, which marks a draft as one.
 */
export async function forward(app: WorkerStub, request: Request, base: string, userEmail: string, appName = "", opts: { draft?: boolean } = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = "/" + url.pathname.slice(base.length);
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-vibe-user", userEmail);
  headers.set("x-vibe-base", base);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const res = await app.getEntrypoint().fetch(
    new Request(`https://app${path}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
    }),
  );

  const out = new Headers(res.headers);
  // Apps share the platform's origin. So they can't set cookies on it, and their pages
  // can't run scripts of their own: a script on this origin could call the platform's API
  // as whoever opened the app. Apps are server-rendered HTML and forms, with vibe's script
  // (kit/browser.js) for autosave, copy and live values. To allow apps' own scripts, serve
  // apps from their own hostname first.
  out.delete("set-cookie");
  out.set("content-security-policy", appCsp(url.origin));
  out.set("x-content-type-options", "nosniff");
  const location = out.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) out.set("location", base.replace(/\/$/, "") + location);
  // HTML pages get vibe's top bar (lib/topbar.ts) and vibe's script.
  if (out.get("content-type")?.startsWith("text/html")) {
    const appId = /^\/apps\/([^/]+)\//.exec(base)?.[1] ?? "";
    out.delete("content-length");
    return new Response(withVibeScript(withTopBar(await res.text(), { id: appId, name: appName, draft: opts.draft }, userEmail)), { status: res.status, statusText: res.statusText, headers: out });
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
