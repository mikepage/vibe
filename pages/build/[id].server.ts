import { defineHandler, type InferProps } from "void"
import { canEdit, canView, draftSummary, getApp, getDraft, listVersions, loadFiles, sharedTeams } from "../../lib/apps.ts"
import { isAdmin } from "../../lib/admin.ts"
import { me } from "../../lib/http.ts"
import { outboundOf } from "../../lib/outbound.ts"
import { crumb } from "../../lib/pages.ts"
import { allTeams, myTeams } from "../../lib/teams.ts"

export type Props = InferProps<typeof loader>

// One app: open it, and for its owner (or a super admin), change it with prompts into a draft
// they try and then publish, and share it. Everyone who may see it sees its versions and files.
export const loader = defineHandler(async (c) => {
  const email = me()
  const app = await getApp(c.req.param("id") ?? "")
  if (!app || !(isAdmin() || (await canView(app, email)))) return c.text("No such app, or it isn't shared with you.", 404)
  crumb(c, app.name)
  const admin = isAdmin()
  const owner = canEdit(app, email) || admin
  const [versions, shared, teams, files, draft] = await Promise.all([
    listVersions(app.id),
    sharedTeams(app.id),
    admin ? allTeams() : owner ? myTeams(email) : Promise.resolve([]),
    app.currentVersion ? loadFiles(app.id, app.currentVersion) : Promise.resolve(null),
    owner ? getDraft(app.id) : Promise.resolve(undefined),
  ])
  return {
    app: { id: app.id, name: app.name, owner: app.ownerEmail, visibility: app.visibility, version: app.currentVersion, outbound: outboundOf(app) },
    isOwner: owner,
    /** A super admin on someone else's app: the page says so. */
    asAdmin: admin && app.ownerEmail !== email,
    versions: versions.map((v) => ({ version: v.version, prompt: v.prompt, by: v.createdBy, buildMs: v.buildMs, kb: Math.round(v.bundleBytes / 1024), attempts: v.attempts, at: v.createdAt })),
    sharedTeamIds: shared.map((t) => t.id),
    teams: teams.map((t) => ({ id: t.id, name: t.name, members: t.members.length })),
    files: files ? Object.entries(files).map(([name, body]) => ({ name, body })) : [],
    draft: draft ? draftSummary(draft) : null,
  }
})
