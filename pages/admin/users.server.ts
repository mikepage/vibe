import { defineHandler, type InferProps } from "void"
import { getSession } from "void/auth"
import { db, sql } from "void/db"
import { adminOnly } from "../../lib/admin-pages.ts"

export type Props = InferProps<typeof loader>

// Admin: everyone who has signed in, with their role and how many apps they own.
export const loader = defineHandler(async (c) => {
  const refused = adminOnly(c)
  if (refused) return refused
  // Better Auth's tables aren't in db/schema.ts (Void generates them).
  const users = await db.all<{ id: string; name: string; email: string; role: string | null; createdAt: number; apps: number }>(
    sql`SELECT u.id, u.name, u.email, u.role, u."createdAt" AS "createdAt", (SELECT count(*) FROM apps a WHERE a.owner_email = lower(u.email)) AS apps
        FROM user u ORDER BY lower(u.email)`,
  )
  return { users: users.map((u) => ({ ...u, admin: (u.role ?? "").split(",").includes("admin") })), me: getSession()?.user.id ?? "" }
})
