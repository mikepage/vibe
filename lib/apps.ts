// Apps, sharing and versions in D1; source and bundles in R2.

import { apps, drafts, shares, teamMembers, teams, versions } from "@schema";
import { and, db, desc, eq, inArray, or } from "void/db";
import { storage } from "void/storage";
import type { Bundle, Built } from "./build.ts";
import type { Files } from "./checks.ts";

export type App = typeof apps.$inferSelect;
export type Visibility = App["visibility"];

export async function getApp(id: string): Promise<App | undefined> {
  return db.select().from(apps).where(eq(apps.id, id)).get();
}

export async function teamIdsOf(email: string): Promise<string[]> {
  const rows = await db.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.email, email)).all();
  return rows.map((r) => r.id);
}

/** Owner, everyone (when shared with everyone), or a member of a team it's shared with. */
export async function canView(app: App, email: string): Promise<boolean> {
  if (app.ownerEmail === email || app.visibility === "everyone") return true;
  if (app.visibility !== "teams") return false;
  const row = await db
    .select({ teamId: shares.teamId })
    .from(shares)
    .innerJoin(teamMembers, eq(teamMembers.teamId, shares.teamId))
    .where(and(eq(shares.appId, app.id), eq(teamMembers.email, email)))
    .get();
  return row !== undefined;
}

export const canEdit = (app: App, email: string) => app.ownerEmail === email;

/** Apps the user owns, and apps others shared with them. */
export async function visibleApps(email: string): Promise<{ own: App[]; shared: App[] }> {
  const own = await db.select().from(apps).where(eq(apps.ownerEmail, email)).orderBy(desc(apps.updatedAt)).all();
  const myTeams = await teamIdsOf(email);
  const sharedIds = myTeams.length
    ? (await db.select({ id: shares.appId }).from(shares).where(inArray(shares.teamId, myTeams)).all()).map((r) => r.id)
    : [];
  const visible = or(eq(apps.visibility, "everyone"), sharedIds.length ? and(eq(apps.visibility, "teams"), inArray(apps.id, sharedIds)) : undefined);
  const shared = (await db.select().from(apps).where(visible).orderBy(desc(apps.updatedAt)).all()).filter(
    (a) => a.ownerEmail !== email && a.currentVersion !== null,
  );
  return { own, shared };
}

export async function sharedTeams(appId: string) {
  return db.select({ id: teams.id, name: teams.name }).from(shares).innerJoin(teams, eq(teams.id, shares.teamId)).where(eq(shares.appId, appId)).all();
}

const key = (appId: string, version: number, file: "files" | "bundle") => `apps/${appId}/v${version}/${file}.json`;
const draftKey = (appId: string, file: "files" | "bundle") => `apps/${appId}/draft/${file}.json`;

const bundleOf = (built: Bundle): Bundle => ({ mainModule: built.mainModule, modules: built.modules });

export async function saveVersion(
  app: App,
  input: { files: Files; built: Bundle & { buildMs: number; bytes: number }; prompt: string | null; createdBy: string; attempts: number },
): Promise<number> {
  const [last] = await db.select({ v: versions.version }).from(versions).where(eq(versions.appId, app.id)).orderBy(desc(versions.version)).limit(1).all();
  const version = (last?.v ?? 0) + 1;
  await storage.put(key(app.id, version, "files"), JSON.stringify(input.files));
  await storage.put(key(app.id, version, "bundle"), JSON.stringify(bundleOf(input.built)));
  await db.batch([
    db.insert(versions).values({
      appId: app.id,
      version,
      prompt: input.prompt,
      createdBy: input.createdBy,
      attempts: input.attempts,
      buildMs: input.built.buildMs,
      bundleBytes: input.built.bytes,
    }),
    db.update(apps).set({ currentVersion: version, updatedAt: Date.now() }).where(eq(apps.id, app.id)),
  ]);
  return version;
}

export type Draft = typeof drafts.$inferSelect;

export async function getDraft(appId: string): Promise<Draft | undefined> {
  return db.select().from(drafts).where(eq(drafts.appId, appId)).get();
}

export const draftPrompts = (draft: Draft): string[] => JSON.parse(draft.prompts) as string[];

/** A draft as the build page and the API show it. */
export const draftSummary = (draft: Draft) => ({
  prompts: draftPrompts(draft),
  baseVersion: draft.baseVersion,
  by: draft.createdBy,
  attempts: draft.attempts,
  buildMs: draft.buildMs,
  kb: Math.round(draft.bundleBytes / 1024),
  hash: draft.hash,
  at: draft.updatedAt,
});

/** Stores a newly built draft over the app's previous one, adding its prompt to the draft's prompts. */
export async function saveDraft(
  app: App,
  input: { files: Files; built: Built; prompt: string; createdBy: string; attempts: number },
): Promise<Draft> {
  const previous = await getDraft(app.id);
  const row = {
    appId: app.id,
    prompts: JSON.stringify([...(previous ? draftPrompts(previous) : []), input.prompt]),
    baseVersion: previous ? previous.baseVersion : app.currentVersion,
    createdBy: input.createdBy,
    attempts: (previous?.attempts ?? 0) + input.attempts,
    buildMs: input.built.buildMs,
    bundleBytes: input.built.bytes,
    hash: input.built.hash,
    updatedAt: Date.now(),
  };
  await storage.put(draftKey(app.id, "files"), JSON.stringify(input.files));
  await storage.put(draftKey(app.id, "bundle"), JSON.stringify(bundleOf(input.built)));
  await db.insert(drafts).values(row).onConflictDoUpdate({ target: drafts.appId, set: row });
  return row;
}

export async function loadDraftFiles(appId: string): Promise<Files | null> {
  const object = await storage.get(draftKey(appId, "files"));
  return object ? ((await object.json()) as Files) : null;
}

async function loadDraftBundle(appId: string): Promise<Bundle> {
  const object = await storage.get(draftKey(appId, "bundle"));
  if (!object) throw new Error(`no draft bundle for ${appId}`);
  return (await object.json()) as Bundle;
}

/** The draft's bundle, by its hash: a newer draft has another hash, so it's never served from the cache. */
export const draftBundle = (appId: string, hash: string): Promise<Bundle> => cached(`draft:${appId}:${hash}`, () => loadDraftBundle(appId));

export async function deleteDraft(appId: string): Promise<void> {
  await db.delete(drafts).where(eq(drafts.appId, appId));
  await storage.delete([draftKey(appId, "files"), draftKey(appId, "bundle")]);
}

/** The draft becomes the app's next version, as it was built and tested. Its prompts become the version's prompt. */
export async function publishDraft(app: App, draft: Draft): Promise<number> {
  const [files, bundle] = await Promise.all([loadDraftFiles(app.id), loadDraftBundle(app.id)]);
  if (!files) throw new Error(`no draft files for ${app.id}`);
  const version = await saveVersion(app, {
    files,
    built: { ...bundle, buildMs: draft.buildMs, bytes: draft.bundleBytes },
    prompt: draftPrompts(draft).join("\n\n"),
    createdBy: draft.createdBy,
    attempts: draft.attempts,
  });
  await deleteDraft(app.id);
  return version;
}

// Bundles are immutable per version (and per draft hash), so a finished bundle can stay in memory.
const bundles = new Map<string, Bundle>();

async function cached(k: string, load: () => Promise<Bundle>): Promise<Bundle> {
  const hit = bundles.get(k);
  if (hit) return hit;
  const bundle = await load();
  if (bundles.size > 200) bundles.clear();
  bundles.set(k, bundle);
  return bundle;
}

export async function loadBundle(appId: string, version: number): Promise<Bundle> {
  const k = key(appId, version, "bundle");
  return cached(k, async () => {
    const object = await storage.get(k);
    if (!object) throw new Error(`no bundle for ${appId} v${version}`);
    return (await object.json()) as Bundle;
  });
}

export async function loadFiles(appId: string, version: number): Promise<Files | null> {
  const object = await storage.get(key(appId, version, "files"));
  return object ? ((await object.json()) as Files) : null;
}

export async function listVersions(appId: string) {
  return db.select().from(versions).where(eq(versions.appId, appId)).orderBy(desc(versions.version)).all();
}

/** "Expense tracker" → "expense-tracker-3f9a". */
export function newAppId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "app";
  return `${slug}-${crypto.randomUUID().slice(0, 4)}`;
}
