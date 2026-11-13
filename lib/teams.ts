import { teamMembers, teams } from "@schema";
import { and, asc, db, eq, inArray } from "void/db";
import { teamIdsOf } from "./apps.ts";

export type Team = typeof teams.$inferSelect & { members: string[] };

export async function myTeams(email: string): Promise<Team[]> {
  const ids = await teamIdsOf(email);
  if (ids.length === 0) return [];
  const rows = await db.select().from(teams).where(inArray(teams.id, ids)).orderBy(asc(teams.name)).all();
  const members = await db.select().from(teamMembers).where(inArray(teamMembers.teamId, ids)).orderBy(asc(teamMembers.email)).all();
  return rows.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id).map((m) => m.email) }));
}

/** Every team with its members, for super admins. */
export async function allTeams(): Promise<Team[]> {
  const rows = await db.select().from(teams).orderBy(asc(teams.name)).all();
  const members = await db.select().from(teamMembers).orderBy(asc(teamMembers.email)).all();
  return rows.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id).map((m) => m.email) }));
}

export async function isMember(teamId: string, email: string): Promise<boolean> {
  const row = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.email, email))).get();
  return row !== undefined;
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
