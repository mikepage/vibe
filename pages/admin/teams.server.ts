import { defineHandler, type InferProps } from "void"
import { adminOnly } from "../../lib/admin-pages.ts"
import { allTeams } from "../../lib/teams.ts"

export type Props = InferProps<typeof loader>

// Admin: every team and its members.
export const loader = defineHandler(async (c) => {
  const refused = adminOnly(c)
  if (refused) return refused
  return { teams: (await allTeams()).map((t) => ({ id: t.id, name: t.name, createdBy: t.createdBy, members: t.members })) }
})
