import { teamMembers } from "@schema";
import { defineHandler } from "void";
import { and, db, eq } from "void/db";
import { teams } from "@schema";
import { isAdmin } from "../../../../lib/admin.ts";
import { me, fail, json } from "../../../../lib/http.ts";
import { EMAIL, isMember } from "../../../../lib/teams.ts";

// Members manage their team, super admins every team: { email } adds or removes someone.
async function input(c: Parameters<Parameters<typeof defineHandler>[0]>[0]) {
  const teamId = c.req.param("id") ?? "";
  const allowed = isAdmin() ? Boolean(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).get()) : await isMember(teamId, me(c));
  if (!allowed) return fail(c, 404, "No such team.");
  const { email } = await json<{ email: string }>(c);
  const clean = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(clean)) return fail(c, 400, "That's not an email address.");
  return { teamId, email: clean };
}

export const POST = defineHandler(async (c) => {
  const v = await input(c);
  if (v instanceof Response) return v;
  await db.insert(teamMembers).values(v).onConflictDoNothing();
  return c.json(v, 201);
});

export const DELETE = defineHandler(async (c) => {
  const v = await input(c);
  if (v instanceof Response) return v;
  await db.delete(teamMembers).where(and(eq(teamMembers.teamId, v.teamId), eq(teamMembers.email, v.email)));
  return { removed: v.email };
});
