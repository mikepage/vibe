import type { Context } from "hono";
import { getSession } from "void/auth";
import { isAdmin } from "./admin.ts";
import { canEdit, canView, getApp, type App } from "./apps.ts";

/** The signed-in user's email, lowercased. middleware/01.session.ts lets no request without a session this far. */
export function me(_c?: Context): string {
  const session = getSession();
  if (!session) throw new Error("No session.");
  return session.user.email.toLowerCase();
}

export const fail = (c: Context, status: 400 | 403 | 404 | 409 | 422 | 500 | 502, error: string, extra: object = {}) =>
  c.json({ error, ...extra }, status);

/** The app in the URL, if the signed-in user may see it (or edit it, with `edit`). Super admins may do both with every app. */
export async function appFor(c: Context, mode: "view" | "edit"): Promise<App | Response> {
  const app = await getApp(c.req.param("id") ?? "");
  const email = me(c);
  if (app && isAdmin()) return app;
  if (!app || !(await canView(app, email))) return fail(c, 404, "No such app.");
  if (mode === "edit" && !canEdit(app, email)) return fail(c, 403, "Only the owner can change this app.");
  return app;
}

export async function json<T>(c: Context): Promise<Partial<T>> {
  try {
    return (await c.req.json()) as Partial<T>;
  } catch {
    return {};
  }
}
