import { defineHandler } from "void";
import { eventStream } from "void/sse";
import { AppData } from "../../../../../durable-objects/app-data.ts";
import { deleteDraft, draftSummary, getDraft, loadDraftFiles, loadFiles } from "../../../../../lib/apps.ts";
import { generateDraft } from "../../../../../lib/deploy.ts";
import { GenerateError } from "../../../../../lib/generate.ts";
import { appFor, fail, json, me } from "../../../../../lib/http.ts";
import { draftDataId } from "../../../../../lib/serve.ts";

export const GET = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const draft = await getDraft(app.id);
  return { draft: draft ? draftSummary(draft) : null };
});

// { prompt }: Claude changes the draft (or starts one from the current version, or writes the
// app), as Server-Sent Events: `attempt`, `text` (Claude's reply as it arrives), `step`, then
// `done` with the draft or `failed` with the error. The current version stays as it is.
export const POST = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const { prompt } = await json<{ prompt: string }>(c);
  if (!prompt?.trim()) return fail(c, 400, "Describe what to build or change.");
  const by = me(c);
  const current = (await getDraft(app.id)) ? await loadDraftFiles(app.id) : app.currentVersion ? await loadFiles(app.id, app.currentVersion) : null;

  return eventStream(async (stream) => {
    // A closed page doesn't stop the generation: the draft is there when it's opened again.
    const send = (event: string, data: unknown) => stream.send({ event, data }).catch(() => {});
    const work = (async () => {
      try {
        const out = await generateDraft(c, app, prompt.trim(), current, by, (p) => void send(p.type, p));
        await send("done", { draft: draftSummary(out.draft), attempts: out.attempts });
      } catch (e) {
        await send("failed", { error: (e as Error).message, steps: e instanceof GenerateError ? e.steps : [] });
      }
    })();
    c.executionCtx.waitUntil(work);
    await work;
  });
});

// Discards the draft and the data it was tried with.
export const DELETE = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  await Promise.all([deleteDraft(app.id), AppData.get(draftDataId(app.id)).clear()]);
  return { discarded: app.id };
});
