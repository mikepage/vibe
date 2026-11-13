import { apps, versions } from "@schema"
import { defineHandler, type InferProps } from "void"
import { db, desc, sql } from "void/db"
import { adminOnly } from "../../lib/admin-pages.ts"

export type Props = InferProps<typeof loader>

// Every app, whoever owns it, newest change first.
export const loader = defineHandler(async (c) => {
  const refused = adminOnly(c)
  if (refused) return refused
  const rows = await db
    .select({ id: apps.id, name: apps.name, owner: apps.ownerEmail, visibility: apps.visibility, version: apps.currentVersion, outbound: apps.outbound, updatedAt: apps.updatedAt, versions: sql<number>`(SELECT count(*) FROM ${versions} WHERE ${versions.appId} = ${apps.id})` })
    .from(apps)
    .orderBy(desc(apps.updatedAt))
    .all()
  return { apps: rows }
})
