import { defineHandler } from "void";
import type { Files } from "../../../../lib/checks.ts";
import { deployFiles } from "../../../../lib/deploy.ts";
import { me, appFor, fail, json } from "../../../../lib/http.ts";

// { files }: deploys hand-written files through the same checks, build and smoke test.
export const POST = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const { files } = await json<{ files: Files }>(c);
  if (!files || typeof files !== "object") return fail(c, 400, "Send { files: { name: source } }.");
  try {
    const out = await deployFiles(c, app, files, me(c));
    return { version: out.version, steps: out.steps, buildMs: out.built.buildMs, bytes: out.built.bytes, smoke: out.smoke };
  } catch (e) {
    return fail(c, 422, (e as Error).message, { steps: (e as { steps?: unknown }).steps });
  }
});
