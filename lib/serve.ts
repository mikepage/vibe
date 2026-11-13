import { me } from "./http.ts";
import type { Context } from "hono";
import { isAdmin } from "./admin.ts";
import { canEdit, canView, draftBundle, getApp, getDraft, loadBundle } from "./apps.ts";
import { outboundKey, outboundOf } from "./outbound.ts";
import { forward, loadApp, userKey } from "./runtime.ts";

/** Where an app's draft is served, under the app's own path so vibe's script and the CSP treat it as the app. */
export const DRAFT_SEGMENT = "~draft";

/** The data space a draft runs against: never the app's own, and cleared on publish and discard. */
export const draftDataId = (appId: string) => `${appId}~draft`;

/**
 * /apps/<id>/... → the app's current version, in the signed-in user's isolate.
 * /apps/<id>/~draft/... → its draft, for whoever may change the app, against the draft's own data.
 */
export async function serveApp(c: Context, id: string): Promise<Response> {
  const email = me(c);
  const app = await getApp(id);
  if (!app || !(isAdmin() || (await canView(app, email)))) return c.text("No such app, or it isn't shared with you.", 404);
  const root = `/apps/${app.id}/`;
  const path = new URL(c.req.url).pathname;
  if (path === root.slice(0, -1)) return c.redirect(root);
  // The network setting is part of the id: after a change, the next request gets a new isolate.
  const outbound = outboundOf(app);
  const keys = `${await userKey(email)}~${await userKey(outboundKey(outbound))}`;

  if (path === `${root}${DRAFT_SEGMENT}` || path.startsWith(`${root}${DRAFT_SEGMENT}/`)) {
    if (!(isAdmin() || canEdit(app, email))) return c.text("Only the owner can try the draft.", 404);
    const base = `${root}${DRAFT_SEGMENT}/`;
    if (path === base.slice(0, -1)) return c.redirect(base);
    const draft = await getDraft(app.id);
    if (!draft) return c.text("This app has no draft.", 404);
    const stub = loadApp(c, {
      isolateId: `${draftDataId(app.id)}~${draft.hash}~${keys}`,
      props: { appId: draftDataId(app.id), userEmail: email },
      outbound,
      bundle: () => draftBundle(app.id, draft.hash),
    });
    return run(c, () => forward(stub, c.req.raw, base, email, app.name, { draft: true }), app.id);
  }

  const version = app.currentVersion;
  if (!version) return c.text("This app has no working version yet.", 404);
  const stub = loadApp(c, {
    isolateId: `${app.id}@${version}~${keys}`,
    props: { appId: app.id, userEmail: email },
    outbound,
    bundle: () => loadBundle(app.id, version),
  });
  return run(c, () => forward(stub, c.req.raw, root, email, app.name), app.id);
}

async function run(c: Context, serve: () => Promise<Response>, id: string): Promise<Response> {
  try {
    return await serve();
  } catch (e) {
    return c.text(`App ${id} failed: ${(e as Error).message}`, 502);
  }
}
