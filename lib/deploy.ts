// Turning files into a stored version or draft: build them in the Builder Durable Object,
// start the result and request GET /, and store it only if it answers.

import type { Context } from "hono";
import { Builder } from "../durable-objects/builder.ts";
import { saveDraft, saveVersion, type App, type Draft } from "./apps.ts";
import type { BuildResult, Built } from "./build.ts";
import type { Files } from "./checks.ts";
import { generate, type Progress, type Step } from "./generate.ts";
import { describeOutbound, outboundKey, outboundOf } from "./outbound.ts";
import { forward, loadApp, userKey } from "./runtime.ts";

export const SMOKE_USER = "smoke-test@vibe.invalid";

export type Deployed = { version: number; built: Built; smoke: { status: number; ms: number }; steps: Step[]; attempts: number };

/** Builds and smoke-tests files. Throws an Error with a message for the model. */
async function tryFiles(c: Context, app: App, files: Files, report: (step: Step) => void, attempt: number): Promise<{ built: Built; smoke: { status: number; ms: number } }> {
  const result = (await Builder.get("builder").build(files)) as BuildResult;
  if (!result.ok) throw new Error(result.error);
  const built = result.built;
  report({ step: "build", attempt, ms: built.buildMs, message: `${Math.round(built.bytes / 1024)} KB` });

  // The smoke test runs as a throwaway user against a throwaway data space, with the
  // app's own network setting.
  const start = performance.now();
  const outbound = outboundOf(app);
  const stub = loadApp(c, {
    isolateId: `${app.id}~smoke~${built.hash}~${await userKey(outboundKey(outbound))}`,
    props: { appId: `${app.id}~smoke`, userEmail: SMOKE_USER },
    outbound,
    bundle: async () => built,
  });
  let res: Response;
  try {
    res = await forward(stub, new Request("https://platform/apps/smoke/"), "/apps/smoke/", SMOKE_USER, app.name);
  } catch (e) {
    throw new Error(`GET / failed: ${(e as Error).message}`, { cause: e });
  }
  const body = await res.text();
  const ms = Math.round(performance.now() - start);
  report({ step: "smoke", attempt, ms, message: `GET / → ${res.status}` });
  if (res.status >= 400) throw new Error(`GET / answered ${res.status}:\n${body.slice(0, 3000)}`);
  return { built, smoke: { status: res.status, ms } };
}

/** Hand-written files: build, smoke-test, store. One attempt. */
export async function deployFiles(c: Context, app: App, files: Files, by: string): Promise<Deployed> {
  const steps: Step[] = [];
  try {
    const { built, smoke } = await tryFiles(c, app, files, (s) => steps.push(s), 1);
    const version = await saveVersion(app, { files, built, prompt: null, createdBy: by, attempts: 1 });
    return { version, built, smoke, steps, attempts: 1 };
  } catch (e) {
    steps.push({ step: "error", attempt: 1, message: (e as Error).message });
    throw Object.assign(new Error((e as Error).message), { steps });
  }
}

/** A prompt: Claude writes or changes the app, up to three attempts. */
export async function generateVersion(c: Context, app: App, prompt: string, current: Files | null, by: string): Promise<Deployed & { files: Files }> {
  const { files, result, steps, attempts } = await generate({ prompt, current, network: describeOutbound(outboundOf(app)) }, (f, s, n) => tryFiles(c, app, f, s, n));
  const version = await saveVersion(app, { files, built: result.built, prompt, createdBy: by, attempts });
  return { version, files, built: result.built, smoke: result.smoke, steps, attempts };
}

/**
 * A prompt into the app's draft: Claude changes the draft (or the current version, or writes
 * the app), streaming its progress to `emit`. The current version stays as it is.
 */
export async function generateDraft(
  c: Context,
  app: App,
  prompt: string,
  current: Files | null,
  by: string,
  emit: (progress: Progress) => void,
): Promise<{ draft: Draft; steps: Step[]; attempts: number }> {
  const { files, result, steps, attempts } = await generate(
    { prompt, current, network: describeOutbound(outboundOf(app)) },
    (f, report, n) => tryFiles(c, app, f, report, n),
    emit,
  );
  const draft = await saveDraft(app, { files, built: result.built, prompt, createdBy: by, attempts });
  return { draft, steps, attempts };
}
