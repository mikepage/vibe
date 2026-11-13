import { defineHandler } from "void";
import { AppData } from "../../../../../durable-objects/app-data.ts";
import { getDraft, publishDraft } from "../../../../../lib/apps.ts";
import { appFor, fail } from "../../../../../lib/http.ts";
import { draftDataId } from "../../../../../lib/serve.ts";

// The draft becomes the app's next version, as built and tested. The data it was tried with goes.
export const POST = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const draft = await getDraft(app.id);
  if (!draft) return fail(c, 404, "This app has no draft.");
  const version = await publishDraft(app, draft);
  await AppData.get(draftDataId(app.id)).clear();
  return { version };
});
