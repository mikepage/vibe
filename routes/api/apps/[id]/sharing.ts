import { apps, shares } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { isAdmin } from "../../../../lib/admin.ts";
import { teamIdsOf } from "../../../../lib/apps.ts";
import { me, appFor, fail, json } from "../../../../lib/http.ts";

// { visibility: "private" | "teams" | "everyone", teamIds?: string[] }
// You can share an app with teams you belong to; a super admin with any team.
export const PUT = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const body = await json<{ visibility: string; teamIds: string[] }>(c);
  const visibility = body.visibility;
  if (visibility !== "private" && visibility !== "teams" && visibility !== "everyone") {
    return fail(c, 400, 'visibility is "private", "teams" or "everyone".');
  }
  const teamIds = visibility === "teams" ? [...new Set(body.teamIds ?? [])] : [];
  if (visibility === "teams" && teamIds.length === 0) return fail(c, 400, "Pick at least one team.");
  const mine = new Set(await teamIdsOf(me(c)));
  const notMine = isAdmin() ? [] : teamIds.filter((t) => !mine.has(t));
  if (notMine.length) return fail(c, 403, `You're not in team ${notMine.join(", ")}.`);

  await db.batch([
    db.update(apps).set({ visibility, updatedAt: Date.now() }).where(eq(apps.id, app.id)),
    db.delete(shares).where(eq(shares.appId, app.id)),
    ...teamIds.map((teamId) => db.insert(shares).values({ appId: app.id, teamId })),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return { id: app.id, visibility, teamIds };
});
