import { sql } from "void/db";
import { integer, primaryKey, sqliteTable, text } from "void/schema-d1";

const now = sql`(unixepoch() * 1000)`;

// Better Auth's tables (user, session, account, verification) aren't here: Void
// generates them from auth.ts. Apps, teams and shares key on the user's email.

// Teams are managed in the platform: a name and member emails.
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.email] })],
);

// visibility: "private" (owner only), "teams" (owner and members of the shared teams),
// "everyone" (everyone who passes Access).
export const apps = sqliteTable("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  visibility: text("visibility", { enum: ["private", "teams", "everyone"] })
    .notNull()
    .default("private"),
  currentVersion: integer("current_version"),
  // What the app may fetch: "disabled" (nothing, the default), "allowlist" (only the hosts
  // in outbound_hosts, a JSON array) or "all" (any host). Enforced by lib/runtime.ts.
  outbound: text("outbound", { enum: ["disabled", "allowlist", "all"] })
    .notNull()
    .default("disabled"),
  outboundHosts: text("outbound_hosts").notNull().default("[]"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

// One row per team an app is shared with. Only read when visibility is "teams".
export const shares = sqliteTable(
  "shares",
  {
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.appId, t.teamId] })],
);

// An app's draft: built and smoke-tested from one or more prompts, tried by its owner at
// /apps/<id>/~draft/ with its own data, then published as a version or discarded. One per
// app. Source and bundle live in R2; `hash` names the bundle, so a new draft gets new isolates.
// `prompts` is a JSON array; `baseVersion` is the version it started from.
export const drafts = sqliteTable("drafts", {
  appId: text("app_id")
    .primaryKey()
    .references(() => apps.id, { onDelete: "cascade" }),
  prompts: text("prompts").notNull(),
  baseVersion: integer("base_version"),
  createdBy: text("created_by").notNull(),
  attempts: integer("attempts").notNull(),
  buildMs: integer("build_ms").notNull(),
  bundleBytes: integer("bundle_bytes").notNull(),
  hash: text("hash").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

// Every version that answered its smoke request. Source and bundle live in R2.
export const versions = sqliteTable(
  "versions",
  {
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    prompt: text("prompt"),
    createdBy: text("created_by").notNull(),
    attempts: integer("attempts").notNull(),
    buildMs: integer("build_ms").notNull(),
    bundleBytes: integer("bundle_bytes").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.appId, t.version] })],
);
