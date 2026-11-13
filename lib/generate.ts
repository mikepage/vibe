// Prompt in, working app out. Claude writes the files; every failure (no files, a missing
// package, a build error, a crash or error status on GET /) goes back to Claude as the next
// message. Three attempts. With `emit`, Claude's reply streams: the caller sees each attempt,
// the text as it arrives, and each step.

import { ai } from "void/ai";
import { env } from "void/env";
import type { Files } from "./checks.ts";
import { SYSTEM } from "./prompt.ts";

export const MAX_ATTEMPTS = 3;

export type Step = {
  step: "generate" | "build" | "smoke" | "error";
  attempt: number;
  ms?: number;
  files?: string[];
  message?: string;
};

/** What a streamed generation reports as it goes. */
export type Progress = { type: "attempt"; attempt: number } | { type: "text"; attempt: number; text: string } | { type: "step"; step: Step };

export class GenerateError extends Error {
  constructor(
    message: string,
    readonly steps: Step[],
  ) {
    super(message);
  }
}

/** Tries a set of files, reporting its steps: throws an Error whose message the model should see, or returns T. */
export type Attempt<T> = (files: Files, report: (step: Step) => void, attempt: number) => Promise<T>;

const FENCE = /```[^\n`]*?([\w./-]+\.(?:tsx|ts|jsx|js|json|css))[^\n]*\n([\s\S]*?)\n```/g;

export function parseFiles(text: string): Files {
  const files: Files = {};
  for (const [, name, body] of text.matchAll(FENCE)) {
    const clean = name.replace(/^\.?\//, "");
    if (!clean.startsWith("_vibe/")) files[clean] = body;
  }
  return files;
}

const render = (files: Files) => Object.entries(files).map(([name, body]) => `\`\`\`${name}\n${body}\n\`\`\``).join("\n\n");

// The part of an Anthropic Messages reply the loop reads. Content blocks go back to the
// model unchanged, so they stay opaque apart from text.
type Block = { type: string; text?: string } & Record<string, unknown>;
type Message = { role: "user" | "assistant"; content: string | Block[] };
type Reply = { content: Block[]; stop_reason: string | null };

// Claude through the Workers AI binding. Third-party models run through an AI Gateway and are
// paid with Unified Billing credits on the account, so there is no Anthropic key anywhere.
const request = (messages: Message[]) => ({
  max_tokens: 20_000,
  system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
  output_config: { effort: "medium" },
  messages,
});
// The gateway retries failed upstream requests, as the Anthropic SDK did before.
const gateway = () => ({ gateway: { id: env.AI_GATEWAY_ID, retries: { maxAttempts: 3 as const, backoff: "exponential" as const } } });

async function claude(messages: Message[], onText?: (text: string) => void): Promise<Reply> {
  if (onText) return claudeStreamed(messages, onText);
  const reply = (await ai.run(env.AI_MODEL, request(messages), gateway())) as Reply;
  if (!Array.isArray(reply?.content)) throw new Error(`Unexpected reply from ${env.AI_MODEL}: ${JSON.stringify(reply).slice(0, 300)}`);
  return reply;
}

/**
 * The same request with `stream: true`: Anthropic's Messages events as SSE. The content blocks
 * are put back together (thinking and its signature too, as they go back to the model), and
 * text deltas go to `onText` as they arrive.
 */
async function claudeStreamed(messages: Message[], onText: (text: string) => void): Promise<Reply> {
  const body = (await ai.run(env.AI_MODEL, { ...request(messages), stream: true }, gateway())) as unknown;
  if (!(body instanceof ReadableStream)) throw new Error(`Unexpected reply from ${env.AI_MODEL}: ${JSON.stringify(body).slice(0, 300)}`);
  const blocks: Block[] = [];
  let stopReason: string | null = null;
  let seen = "";

  const handle = (event: string, data: string) => {
    if (!data || data === "[DONE]") return;
    if (seen.length < 300) seen += data;
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "void:error" || event === "void:limit") throw new Error(msg.message ?? "Generation was interrupted.");
    switch (msg.type ?? event) {
      case "content_block_start":
        blocks[msg.index] = { ...msg.content_block };
        return;
      case "content_block_delta": {
        const block = (blocks[msg.index] ??= { type: "text", text: "" });
        const delta = msg.delta ?? {};
        if (delta.type === "text_delta") {
          block.text = (block.text ?? "") + delta.text;
          onText(delta.text);
        } else if (delta.type === "thinking_delta") block.thinking = String(block.thinking ?? "") + delta.thinking;
        else if (delta.type === "signature_delta") block.signature = String(block.signature ?? "") + delta.signature;
        return;
      }
      case "message_delta":
        stopReason = msg.delta?.stop_reason ?? stopReason;
        return;
      case "error":
        throw new Error(msg.error?.message ?? "The model's stream failed.");
      default:
        // Workers AI's own stream format, in case the model is ever one of its own.
        if (typeof msg.response === "string" && msg.response) {
          const block = blocks.at(-1)?.type === "text" ? blocks.at(-1)! : (blocks[blocks.length] = { type: "text", text: "" });
          block.text = (block.text ?? "") + msg.response;
          onText(msg.response);
        }
    }
  };

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const frame = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    handle(event, data.join("\n"));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
      frame(buffer.slice(0, end));
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
    }
  }
  if (buffer.trim()) frame(buffer);
  const content = blocks.filter(Boolean);
  if (!content.length) throw new Error(`Unexpected reply from ${env.AI_MODEL}: ${seen.slice(0, 300) || "an empty stream"}`);
  return { content, stop_reason: stopReason };
}

export async function generate<T>(
  opts: { prompt: string; current: Files | null; network: string },
  attemptFiles: Attempt<T>,
  emit?: (progress: Progress) => void,
): Promise<{ files: Files; result: T; steps: Step[]; attempts: number }> {
  const messages: Message[] = [];
  // The network setting changes per app, so it goes here, not in the cached system prompt.
  const intro = `${opts.network}\n\n` + (opts.current ? `The app's current files:\n\n${render(opts.current)}\n\nChange it: ` : "Write this app: ");
  messages.push({ role: "user", content: intro + opts.prompt });

  let files: Files = { ...(opts.current ?? {}) };
  const steps: Step[] = [];
  const report = (step: Step) => {
    steps.push(step);
    emit?.({ type: "step", step });
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = performance.now();
    emit?.({ type: "attempt", attempt });
    const reply = await claude(messages, emit && ((text) => emit({ type: "text", attempt, text })));
    // Thinking blocks go back unchanged on the next turn, so the model keeps its reasoning.
    messages.push({ role: "assistant", content: reply.content });
    if (reply.stop_reason === "refusal") {
      report({ step: "error", attempt, message: "the model declined this request" });
      throw new GenerateError("The model declined this request.", steps);
    }
    const text = reply.content.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("\n");
    const changed = parseFiles(text);
    report({ step: "generate", attempt, ms: Math.round(performance.now() - start), files: Object.keys(changed) });

    if (Object.keys(changed).length === 0) {
      const message = reply.stop_reason === "max_tokens" ? "the reply was cut off before any complete file" : "no files in the reply";
      report({ step: "error", attempt, message });
      messages.push({ role: "user", content: `${message}. Reply with each file in its own fenced block whose info string is the file name.` });
      continue;
    }
    files = { ...files, ...changed };
    try {
      return { files, result: await attemptFiles(files, report, attempt), steps, attempts: attempt };
    } catch (e) {
      const message = (e as Error).message;
      report({ step: "error", attempt, message });
      messages.push({ role: "user", content: `That failed:\n\n${message}\n\nFix it. Reply with each file you change, in full.` });
    }
  }
  throw new GenerateError(`No working app after ${MAX_ATTEMPTS} attempts.`, steps);
}
