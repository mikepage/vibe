// The gateway for an allow-listed app's fetch() (lib/outbound.ts). Those requests arrive
// through ctx.exports with props the platform set when it loaded the isolate
// ({ outboundFor, hosts }); no request from outside can carry props. A listed host is
// fetched as asked, without following redirects: the app's own fetch() follows them, and
// each hop comes back through here. Anything else gets a 403. Runs first, before Access.

import { defineMiddleware } from "void";
import { hostAllowed } from "../lib/outbound.ts";
import { outboundProps } from "../lib/props.ts";

export default defineMiddleware(async (c, next) => {
  const props = outboundProps(c);
  if (!props) return next();
  const url = new URL(c.req.url);
  if (!["http:", "https:"].includes(url.protocol) || !hostAllowed(url.hostname, props.hosts)) {
    return new Response(`vibe: this app may not fetch ${url.hostname}. Its owner allows: ${props.hosts.join(", ") || "nothing"}.\n`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return fetch(new Request(c.req.raw, { redirect: "manual" }));
});
