import { defineHandler } from "void";
import { AppData, SHARED } from "../../../../../durable-objects/app-data.ts";
import { refuseNonAdmin } from "../../../../../lib/admin.ts";
import { getApp } from "../../../../../lib/apps.ts";
import { fail, json } from "../../../../../lib/http.ts";

// Super admins only: an app's data, every user's and the shared space ("~shared").
//   GET                          per space: documents, collections, expiry
//   GET ?user=<email|~shared>    that space's documents (&collection=, &limit=)
//   DELETE { user, collection?, id? }   one document, or the whole space

async function target(c: Parameters<Parameters<typeof defineHandler>[0]>[0]) {
  const refused = refuseNonAdmin(c);
  if (refused) return refused;
  const app = await getApp(c.req.param("id") ?? "");
  return app ?? fail(c, 404, "No such app.");
}

export const GET = defineHandler(async (c) => {
  const app = await target(c);
  if (app instanceof Response) return app;
  const data = AppData.get(app.id);
  const user = c.req.query("user");
  if (!user) return { app: { id: app.id, name: app.name, owner: app.ownerEmail }, shared: SHARED, spaces: await data.overview() };
  return { user, docs: await data.browse(user, c.req.query("collection") || undefined, Number(c.req.query("limit")) || 200) };
});

export const DELETE = defineHandler(async (c) => {
  const app = await target(c);
  if (app instanceof Response) return app;
  const body = await json<{ user: string; collection: string; id: string }>(c);
  if (typeof body.user !== "string" || !body.user) return fail(c, 400, "Say whose data: user is an email or ~shared.");
  try {
    return { deleted: await AppData.get(app.id).remove(body.user, { collection: body.collection, id: body.id }) };
  } catch (e) {
    return fail(c, 400, (e as Error).message);
  }
});
