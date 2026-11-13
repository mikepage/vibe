// A platform under test: the built Worker in workerd behind a stand-in for Cloudflare
// Access (a key pair whose public half a local server publishes, as Access does at
// /cdn-cgi/access/certs), and a stub for Claude on Workers AI.

import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness, type TestHarness } from "wrangler";
import { TEST_CONFIG } from "./build.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const AUD = "test-aud";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Access's issuer for the team the platform runs with (CF_ACCESS_TEAM_DOMAIN "acme").
export const ISSUER = "https://acme.cloudflareaccess.com";

const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

export const newKey = async () => ((await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair).privateKey;

/** Holds a key pair and serves its public half at /cdn-cgi/access/certs, like Access. */
export async function accessTeam() {
  const { publicKey, privateKey } = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-1", alg: "RS256", use: "sig" };
  const server = createServer((req, res) => {
    if (req.url !== "/cdn-cgi/access/certs") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
  });
  const url = await listen(server);
  return { certsUrl: `${url}/cdn-cgi/access/certs`, privateKey, close: () => server.close() };
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const part = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** A token as Access signs it. `expiresAt` in seconds since the epoch; default an hour from now. */
export async function sign(
  key: CryptoKey,
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; expiresAt?: number; kid?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = part({ alg: "RS256", kid: opts.kid ?? "test-1", typ: "JWT" });
  const body = part({
    iss: opts.issuer ?? ISSUER,
    aud: [opts.audience ?? AUD],
    sub: String(claims.email ?? claims.common_name ?? "sub"),
    iat: now,
    nbf: now,
    exp: opts.expiresAt ?? now + 3600,
    ...claims,
  });
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(signature)}`;
}

/**
 * Claude on Workers AI, answering from a queue of reply texts in the Anthropic Messages
 * format that `ai.run("anthropic/...")` returns.
 *
 * The harness can't reach Workers AI, so the platform runs with `void/ai` pointed at this
 * server instead of the AI binding: `__VOID_PROXY_URL` + `__VOID_TOKEN` + `__VOID_PROJECT_ID`
 * select Void's HTTP proxy backend, which POSTs `{ model, inputs, options }` to `<url>/ai/run`
 * and reads the JSON reply. Test-only vars; the deployed Worker uses the AI binding.
 *
 * With `stream: true` in the inputs it answers as Anthropic streams: Server-Sent Events whose
 * text arrives in small deltas, after a thinking block with a signature.
 */
export async function fakeClaude() {
  const replies: string[] = [];
  const requests: { model: string; inputs: { stream?: boolean; messages: { role: string; content: unknown }[] }; options: { gateway?: { id: string } } }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method !== "POST" || req.url !== "/ai/run") return res.writeHead(404).end();
    const request = JSON.parse(body) as (typeof requests)[number];
    requests.push(request);
    const text = replies.shift() ?? "no more replies queued";
    if (request.inputs.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send("message_start", { message: { id: `msg_${requests.length}`, type: "message", role: "assistant", content: [], stop_reason: null } });
      send("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
      send("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Planning the app." } });
      send("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-1" } });
      send("content_block_stop", { index: 0 });
      send("content_block_start", { index: 1, content_block: { type: "text", text: "" } });
      for (let i = 0; i < text.length; i += 40) send("content_block_delta", { index: 1, delta: { type: "text_delta", text: text.slice(i, i + 40) } });
      send("content_block_stop", { index: 1 });
      send("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } });
      send("message_stop", {});
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
  const url = await listen(server);
  return { url, replies, requests, close: () => server.close() };
}

export type Platform = Awaited<ReturnType<typeof startPlatform>>;

export async function startPlatform(opts: { certsUrl: string; claudeUrl: string; ttlSeconds?: number }) {
  const harness: TestHarness = createTestHarness({
    root: ROOT,
    workers: [
      {
        configPath: join(ROOT, TEST_CONFIG),
        vars: { __VOID_PROXY_URL: opts.claudeUrl, __VOID_TOKEN: "test", __VOID_PROJECT_ID: "test" },
        secrets: {
          BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
          CF_ACCESS_TEAM_DOMAIN: "acme",
          CF_ACCESS_AUD: AUD,
          CF_ACCESS_CERTS_URL: opts.certsUrl,
          DATA_TTL_SECONDS: String(opts.ttlSeconds ?? 1_209_600),
        },
      },
    ],
  });
  await harness.listen();

  // Apply the D1 migrations, as `void deploy` does.
  const env = await harness.getWorker<{ DB: D1Database }>().getEnv();
  const dir = join(ROOT, "db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await env.DB.prepare(statement).run();
    }
  }

  const request = async (path: string, init: { token?: string; method?: string; json?: unknown; form?: Record<string, string | string[]>; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token) headers["cf-access-jwt-assertion"] = init.token;
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(Object.entries(init.form).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x]))).toString();
    }
    const res = await harness.fetch(`http://platform.test${path}`, { method: init.method ?? (body === undefined ? "GET" : "POST"), headers, body, redirect: "manual" });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { status: res.status, headers: res.headers, text, data };
  };

  return { harness, request, close: () => harness.close() };
}

export const NOTES_APP = readFileSync(join(ROOT, "examples/notes/index.tsx"), "utf8");

/** An example app's files, as the deploy API takes them. */
export const example = (name: string) =>
  Object.fromEntries(readdirSync(join(ROOT, "examples", name)).map((f) => [f, readFileSync(join(ROOT, "examples", name, f), "utf8")]));

export const fence = (files: Record<string, string>) => Object.entries(files).map(([n, s]) => "```" + n + "\n" + s + "\n```").join("\n\n");

/** Server-Sent Events from a response body, in order. */
export const sseEvents = (text: string) =>
  text
    .split(/\n\n/)
    .map((frame) => {
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      return event && data ? { event, data: JSON.parse(data) } : null;
    })
    .filter((e): e is { event: string; data: any } => e !== null);
