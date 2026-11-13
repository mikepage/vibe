import { defineHandler } from "void";
import { db, sql } from "void/db";
import { getSession } from "void/auth";
import { refuseNonAdmin } from "../../../../../lib/admin.ts";
import { fail, json } from "../../../../../lib/http.ts";

// Super admins only: { role: "admin" | "user" } for a user (Better Auth's user.role). Nobody
// takes away their own admin role, so there is always one left to undo a mistake. With the
// session cookie cache, the change shows within five minutes.
export const PUT = defineHandler(async (c) => {
  const refused = refuseNonAdmin(c);
  if (refused) return refused;
  const id = c.req.param("id") ?? "";
  const { role } = await json<{ role: string }>(c);
  if (role !== "admin" && role !== "user") return fail(c, 400, 'role is "admin" or "user".');
  if (id === getSession()?.user.id && role !== "admin") return fail(c, 400, "You can't take away your own admin role. Ask another admin.");
  const found = await db.get<{ id: string } | undefined>(sql`SELECT id FROM user WHERE id = ${id}`);
  if (!found) return fail(c, 404, "No such user.");
  await db.run(sql`UPDATE user SET role = ${role}, "updatedAt" = ${Date.now()} WHERE id = ${id}`);
  return { id, role };
});
