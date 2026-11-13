import { defineHandler, type InferProps } from "void"
import { AppData, SHARED } from "../../../durable-objects/app-data.ts"
import { adminOnly } from "../../../lib/admin-pages.ts"
import { getApp } from "../../../lib/apps.ts"
import { crumb } from "../../../lib/pages.ts"

export type Props = InferProps<typeof loader>

// Admin: one app's data, per space: each user's private documents and the shared ones.
export const loader = defineHandler(async (c) => {
  const refused = adminOnly(c)
  if (refused) return refused
  const app = await getApp(c.req.param("id") ?? "")
  if (!app) return c.text("No such app.", 404)
  crumb(c, app.name)
  const spaces = await AppData.get(app.id).overview()
  return { app: { id: app.id, name: app.name, owner: app.ownerEmail }, shared: SHARED, spaces }
})
