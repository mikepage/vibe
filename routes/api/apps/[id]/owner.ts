import { apps } from "@schema";
import { defineHandler } from "void";
import { db, eq, sql } from "void/db";
import { appFor, fail, json } from "../../../../lib/http.ts";
import { EMAIL } from "../../../../lib/teams.ts";

// { email }: hands the app to someone else. Only the owner does it, and only to someone who
// has signed in to vibe before (Better Auth's user table), so a typo can't lock the app away.
// The previous owner keeps what its sharing gives them: nothing more, if it's private.
export const PUT = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const { email } = await json<{ email: string }>(c);
  const to = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(to)) return fail(c, 400, "That's not an email address.");
  if (to === app.ownerEmail) return fail(c, 400, "You already own this app.");
  // Better Auth's tables aren't in db/schema.ts (Void generates them).
  const known = await db.get<{ one: number } | undefined>(sql`SELECT 1 AS one FROM user WHERE lower(email) = ${to} LIMIT 1`);
  if (!known) return fail(c, 404, `${to} hasn't signed in to vibe yet. Ask them to open it once, then try again.`);
  await db.update(apps).set({ ownerEmail: to, updatedAt: Date.now() }).where(eq(apps.id, app.id));
  return { id: app.id, owner: to };
});
