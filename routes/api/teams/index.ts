import { teamMembers, teams } from "@schema";
import { defineHandler } from "void";
import { db } from "void/db";
import { me, fail, json } from "../../../lib/http.ts";
import { myTeams } from "../../../lib/teams.ts";

export const GET = defineHandler(async (c) => ({ teams: await myTeams(me(c)) }));

// { name }: a new team with you as its first member.
export const POST = defineHandler(async (c) => {
  const { name } = await json<{ name: string }>(c);
  const clean = String(name ?? "").trim().slice(0, 80);
  if (!clean) return fail(c, 400, "Give the team a name.");
  const id = crypto.randomUUID();
  const email = me(c);
  await db.batch([db.insert(teams).values({ id, name: clean, createdBy: email }), db.insert(teamMembers).values({ teamId: id, email })]);
  return c.json({ id, name: clean, members: [email] }, 201);
});
