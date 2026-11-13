import { apps } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { listVersions, loadFiles, sharedTeams } from "../../../../lib/apps.ts";
import { AppData } from "../../../../durable-objects/app-data.ts";
import { appFor } from "../../../../lib/http.ts";
import { draftDataId } from "../../../../lib/serve.ts";

export const GET = defineHandler(async (c) => {
  const app = await appFor(c, "view");
  if (app instanceof Response) return app;
  const files = app.currentVersion ? await loadFiles(app.id, app.currentVersion) : null;
  return { app, versions: await listVersions(app.id), teams: await sharedTeams(app.id), files };
});

export const DELETE = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  await db.delete(apps).where(eq(apps.id, app.id));
  // Its users' data goes with it: shared data never expires on its own, and the smoke tests'
  // and the draft's too.
  await Promise.all([AppData.get(app.id).clear(), AppData.get(`${app.id}~smoke`).clear(), AppData.get(draftDataId(app.id)).clear()]);
  return { deleted: app.id };
});
