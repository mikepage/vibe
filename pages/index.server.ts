import { defineHandler, type InferProps } from "void"
import { visibleApps, type App } from "../lib/apps.ts"
import { me } from "../lib/http.ts"

export type Props = InferProps<typeof loader>

const row = (a: App) => ({ id: a.id, name: a.name, visibility: a.visibility, owner: a.ownerEmail, version: a.currentVersion })

// Your apps, and the apps others shared with you (with a team you're in, or everyone).
export const loader = defineHandler(async () => {
  const { own, shared } = await visibleApps(me())
  return { own: own.map(row), shared: shared.map(row) }
})
