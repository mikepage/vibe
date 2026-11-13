// Super admins: users whose Better Auth role (the admin plugin's user.role, auth.ts)
// includes "admin". They act as the owner of every app and a member of every team, and
// /admin shows every app, its data, every team and every user. With the session cookie
// cache, a changed role shows within five minutes.
import type { Context } from "hono";
import { getSession } from "void/auth";
import { fail } from "./http.ts";

/** Whether the signed-in user is a super admin. */
export function isAdmin(): boolean {
  const role = (getSession()?.user as { role?: string | null } | undefined)?.role ?? "";
  return role.split(",").map((r) => r.trim()).includes("admin");
}

/** null for a super admin, else the 403 to return. */
export const refuseNonAdmin = (c: Context) => (isAdmin() ? null : fail(c, 403, "Only super admins can do this."));
