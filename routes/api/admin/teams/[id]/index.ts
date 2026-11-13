import { teams } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { refuseNonAdmin } from "../../../../../lib/admin.ts";

// Super admins only: deletes a team. Its members and the apps' shares with it go along
// (foreign keys cascade); apps shared only with it are then visible to their owner alone.
export const DELETE = defineHandler(async (c) => {
  const refused = refuseNonAdmin(c);
  if (refused) return refused;
  const id = c.req.param("id") ?? "";
  await db.delete(teams).where(eq(teams.id, id));
  return { deleted: id };
});
