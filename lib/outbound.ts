// An app's network setting: what its fetch() may reach. "disabled" (the default)
// gives the isolate no outbound at all; "all" gives it the internet; "allowlist"
// sends every request through middleware/00.app-outbound.ts, which lets through
// only the listed hosts. The setting is part of the isolate's id (lib/serve.ts,
// lib/deploy.ts), so a change takes effect on the next request.

export type OutboundMode = "disabled" | "allowlist" | "all";
export type Outbound = { mode: OutboundMode; hosts: string[] };

export const OUTBOUND_MODES: OutboundMode[] = ["disabled", "allowlist", "all"];
export const MAX_HOSTS = 20;

// A host name, or "*." and a domain for that domain's subdomains. No ports, paths or schemes.
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Cleans a list of hosts, or returns the first one that isn't a host. */
export function parseHosts(input: unknown): { hosts: string[] } | { error: string } {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : [];
  const hosts = [...new Set(raw.map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
  const bad = hosts.find((h) => !HOST.test(h));
  if (bad) return { error: `"${bad}" isn't a host name. Write hosts like api.example.com or *.example.com.` };
  if (hosts.length > MAX_HOSTS) return { error: `At most ${MAX_HOSTS} hosts.` };
  return { hosts };
}

/** Whether a hostname is on the list: an exact match, or a subdomain of a "*." entry. */
export function hostAllowed(hostname: string, hosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
}

/** The setting as stored on an app row. */
export function outboundOf(app: { outbound: OutboundMode; outboundHosts: string }): Outbound {
  let hosts: string[] = [];
  try {
    const parsed = JSON.parse(app.outboundHosts);
    if (Array.isArray(parsed)) hosts = parsed.map(String);
  } catch {
    // A broken list allows nothing.
  }
  return { mode: app.outbound, hosts: app.outbound === "allowlist" ? hosts : [] };
}

/** A short key for the isolate id: the same setting, the same isolate. */
export const outboundKey = (o: Outbound) => (o.mode === "allowlist" ? `allow:${o.hosts.join(",")}` : o.mode);

/** What Claude is told about the app's network, with each request. */
export function describeOutbound(o: Outbound): string {
  if (o.mode === "all") return "Network: the app may fetch() any host on the internet.";
  if (o.mode === "allowlist" && o.hosts.length) return `Network: the app may fetch() only these hosts: ${o.hosts.join(", ")}. Other hosts answer 403.`;
  return "Network: none. The app can't fetch() anything; don't try.";
}
