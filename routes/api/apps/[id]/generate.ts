import { defineHandler } from "void";
import { loadFiles } from "../../../../lib/apps.ts";
import { generateVersion } from "../../../../lib/deploy.ts";
import { GenerateError } from "../../../../lib/generate.ts";
import { me, appFor, fail, json } from "../../../../lib/http.ts";

// { prompt }: Claude changes the app (or writes it, if it has no version yet).
export const POST = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const { prompt } = await json<{ prompt: string }>(c);
  if (!prompt?.trim()) return fail(c, 400, "Describe what to build or change.");
  const current = app.currentVersion ? await loadFiles(app.id, app.currentVersion) : null;
  try {
    const out = await generateVersion(c, app, prompt.trim(), current, me(c));
    return { version: out.version, steps: out.steps, attempts: out.attempts, buildMs: out.built.buildMs, bytes: out.built.bytes };
  } catch (e) {
    if (e instanceof GenerateError) return fail(c, 422, e.message, { steps: e.steps });
    return fail(c, 502, (e as Error).message);
  }
});
