import { defineHandler, type InferProps } from "void"
import { me } from "../lib/http.ts"
import { myTeams } from "../lib/teams.ts"

export type Props = InferProps<typeof loader>

// The teams you're in, with their members. Members manage their team.
export const loader = defineHandler(async () => ({
  teams: (await myTeams(me())).map((t) => ({ id: t.id, name: t.name, members: t.members })),
}))
