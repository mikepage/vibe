import { apps } from "@schema";
import { defineHandler } from "void";
import { db } from "void/db";
import { getApp, newAppId, visibleApps } from "../../../lib/apps.ts";
import { generateVersion } from "../../../lib/deploy.ts";
import { GenerateError } from "../../../lib/generate.ts";
import { me, fail, json } from "../../../lib/http.ts";

export const GET = defineHandler(async (c) => visibleApps(me(c)));

// { name, prompt? }: creates a private app; with a prompt, Claude writes its first version.
export const POST = defineHandler(async (c) => {
  const body = await json<{ name: string; prompt: string }>(c);
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return fail(c, 400, "Give the app a name.");
  const id = newAppId(name);
  await db.insert(apps).values({ id, name, ownerEmail: me(c) });
  const app = (await getApp(id))!;
  if (!body.prompt) return c.json({ app }, 201);
  try {
    const out = await generateVersion(c, app, String(body.prompt), null, me(c));
    return c.json({ app: { ...app, currentVersion: out.version }, version: out.version, steps: out.steps, attempts: out.attempts }, 201);
  } catch (e) {
    if (e instanceof GenerateError) return fail(c, 422, e.message, { app, steps: e.steps });
    return fail(c, 502, (e as Error).message, { app });
  }
});
