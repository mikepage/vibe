import type { Context } from "hono";

// What the platform binds into an app's VIBE binding. Set only by src/runtime.ts through
// ctx.exports.default({ props }), so the app can't choose another app or user.
export type AppProps = { appId: string; userEmail: string };

export function appProps(c: Context): AppProps | null {
  const props = (c.executionCtx as ExecutionContext & { props?: Partial<AppProps> }).props;
  return typeof props?.appId === "string" && typeof props.userEmail === "string"
    ? { appId: props.appId, userEmail: props.userEmail }
    : null;
}

// What the platform binds as an allow-listed app's globalOutbound (lib/runtime.ts). Every
// fetch() the app makes arrives at the platform with these props, and
// middleware/00.app-outbound.ts lets through only the listed hosts.
export type OutboundProps = { outboundFor: string; hosts: string[] };

export function outboundProps(c: Context): OutboundProps | null {
  const props = (c.executionCtx as ExecutionContext & { props?: Partial<OutboundProps> }).props;
  return typeof props?.outboundFor === "string" && Array.isArray(props.hosts) ? { outboundFor: props.outboundFor, hosts: props.hosts.map(String) } : null;
}
