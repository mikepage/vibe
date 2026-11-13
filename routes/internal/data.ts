// The other end of an app's VIBE binding. Only requests that come through
// ctx.exports.default({ props }) carry props; a request from a browser has none and gets
// a 404. The user and the app come from the props, never from the request body.

import { defineHandler } from "void";
import { env } from "void/env";
import { AppData, type DataRequest } from "../../durable-objects/app-data.ts";
import { appProps } from "../../lib/props.ts";

export const POST = defineHandler(async (c) => {
  const props = appProps(c);
  if (!props) return c.notFound();
  let req: DataRequest;
  try {
    req = await c.req.json();
  } catch {
    return c.text("Send JSON.", 400);
  }
  try {
    const result = await AppData.get(props.appId).run(props.userEmail, env.DATA_TTL_SECONDS * 1000, req);
    return c.json(result ?? null);
  } catch (e) {
    return c.text((e as Error).message, 400);
  }
});
