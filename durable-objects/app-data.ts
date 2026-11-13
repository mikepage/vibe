import { DurableObject } from "cloudflare:workers";
import { defineDurableObject } from "void/durable";

// One object per app. It holds every user's JSON collections in SQLite, keyed by user.
// A user's data in an app expires `ttlMs` after their last write there: an alarm deletes
// it, and reads skip it if the alarm hasn't run yet.
//
// The app's shared space (`space: "shared"`) is one more "user", SHARED, that everyone who
// can open the app reads and writes. It never expires, and each document records who
// created and last changed it. SHARED has no "@", so no signed-in email can be it.

export const SHARED = "~shared";

export type DataRequest = {
  op: "insert" | "list" | "get" | "update" | "delete";
  /** "private" (the default): the signed-in user's own data. "shared": everyone's. */
  space?: "private" | "shared";
  collection: string;
  id?: string;
  doc?: Record<string, unknown>;
  limit?: number;
};

type Row = { id: string; data: string; created_at: number; updated_at: number; created_by: string | null; updated_by: string | null };

const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DOC_BYTES = 64 * 1024;

export class DataError extends Error {}

class AppDataObject extends DurableObject {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        user TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (user, collection, id));
      CREATE TABLE IF NOT EXISTS owners (
        user TEXT PRIMARY KEY, last_write INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS owners_expires ON owners (expires_at);`);
    // Objects created before the shared space have no authorship columns yet.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(docs)").toArray().map((c) => c.name);
    if (!columns.includes("created_by")) this.sql.exec("ALTER TABLE docs ADD COLUMN created_by TEXT; ALTER TABLE docs ADD COLUMN updated_by TEXT;");
  }

  /**
   * Runs one data operation for `email` in its private space, or in the shared one. Every
   * query is filtered by the space's user.
   */
  async run(email: string, ttlMs: number, req: DataRequest): Promise<unknown> {
    if (!COLLECTION.test(req.collection)) throw new DataError("collection names are 1-64 letters, digits, _ or -");
    if (req.space !== undefined && req.space !== "private" && req.space !== "shared") throw new DataError('space is "private" or "shared"');
    const shared = req.space === "shared";
    const user = shared ? SHARED : email;
    // Shared data never expires: no owner row, so neither the alarm nor reads drop it.
    const touch = shared ? async () => {} : (now: number) => this.touch(user, now, ttlMs);
    const by = shared ? email : null;
    const now = Date.now();
    const [owner] = this.sql.exec<{ expires_at: number }>("SELECT expires_at FROM owners WHERE user = ?", user).toArray();
    if (owner && owner.expires_at <= now) this.forget(user);

    switch (req.op) {
      case "list": {
        const limit = Math.min(Math.max(Number(req.limit) || 100, 1), 1000);
        return this.sql
          .exec<Row>(
            "SELECT id, data, created_at, updated_at, created_by, updated_by FROM docs WHERE user = ? AND collection = ? ORDER BY created_at DESC, id LIMIT ?",
            user, req.collection, limit,
          )
          .toArray()
          .map(toDoc);
      }
      case "get":
        return this.find(user, req.collection, this.id(req)) ?? null;
      case "insert": {
        const data = this.doc(req);
        const id = crypto.randomUUID();
        this.sql.exec(
          "INSERT INTO docs (user, collection, id, data, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          user, req.collection, id, JSON.stringify(data), now, now, by, by,
        );
        await touch(now);
        return toDoc({ id, data: JSON.stringify(data), created_at: now, updated_at: now, created_by: by, updated_by: by });
      }
      case "update": {
        const id = this.id(req);
        const existing = this.find(user, req.collection, id);
        if (!existing) return null;
        const { id: _i, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...fields } = existing;
        const data = this.doc({ ...req, doc: { ...fields, ...this.doc(req) } });
        this.sql.exec(
          "UPDATE docs SET data = ?, updated_at = ?, updated_by = ? WHERE user = ? AND collection = ? AND id = ?",
          JSON.stringify(data), now, by, user, req.collection, id,
        );
        await touch(now);
        return toDoc({ id, data: JSON.stringify(data), created_at: existing.createdAt as number, updated_at: now, created_by: (existing.createdBy as string | undefined) ?? null, updated_by: by });
      }
      case "delete": {
        const deleted = this.sql.exec("DELETE FROM docs WHERE user = ? AND collection = ? AND id = ?", user, req.collection, this.id(req)).rowsWritten > 0;
        if (deleted) await touch(now);
        return deleted;
      }
      default:
        throw new DataError(`unknown op ${String((req as { op: unknown }).op)}`);
    }
  }

  /** Deletes the data of every user whose last write is older than their TTL. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const { user } of this.sql.exec<{ user: string }>("SELECT user FROM owners WHERE expires_at <= ?", now).toArray()) {
      this.forget(user);
    }
    await this.schedule();
  }

  /** For tests and the README numbers: how many users and documents this app holds. */
  stats(): { users: number; docs: number } {
    const [u] = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM owners").toArray();
    const [d] = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM docs").toArray();
    return { users: u.n, docs: d.n };
  }

  // For super admins (routes/api/admin): what the app holds, every document, and deleting.

  /** Per space (each user, and SHARED): how many documents in which collections, and when private data expires. */
  overview(): { user: string; docs: number; collections: string[]; expiresAt: number | null; lastWrite: number | null }[] {
    const rows = this.sql
      .exec<{ user: string; docs: number; collections: string }>("SELECT user, count(*) AS docs, group_concat(DISTINCT collection) AS collections FROM docs GROUP BY user ORDER BY user")
      .toArray();
    const owners = new Map(this.sql.exec<{ user: string; expires_at: number; last_write: number }>("SELECT user, expires_at, last_write FROM owners").toArray().map((o) => [o.user, o]));
    return rows.map((r) => ({
      user: r.user,
      docs: r.docs,
      collections: (r.collections ?? "").split(",").filter(Boolean).sort(),
      expiresAt: owners.get(r.user)?.expires_at ?? null,
      lastWrite: owners.get(r.user)?.last_write ?? null,
    }));
  }

  /** One space's documents, newest first, optionally of one collection. */
  browse(user: string, collection?: string, limit = 200): Record<string, unknown>[] {
    const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = collection
      ? this.sql.exec<Row & { collection: string }>("SELECT collection, id, data, created_at, updated_at, created_by, updated_by FROM docs WHERE user = ? AND collection = ? ORDER BY created_at DESC, id LIMIT ?", user, collection, n)
      : this.sql.exec<Row & { collection: string }>("SELECT collection, id, data, created_at, updated_at, created_by, updated_by FROM docs WHERE user = ? ORDER BY created_at DESC, id LIMIT ?", user, n);
    return rows.toArray().map((r) => ({ collection: r.collection, ...toDoc(r) }));
  }

  /** Deletes one document, or with no id everything of one space. Returns how many documents went. */
  async remove(user: string, target: { collection?: string; id?: string } = {}): Promise<number> {
    if (target.id) {
      if (!target.collection) throw new DataError("collection is required with id");
      return this.sql.exec("DELETE FROM docs WHERE user = ? AND collection = ? AND id = ?", user, target.collection, target.id).rowsWritten;
    }
    const n = this.sql.exec("DELETE FROM docs WHERE user = ?", user).rowsWritten;
    this.sql.exec("DELETE FROM owners WHERE user = ?", user);
    await this.schedule();
    return n;
  }

  /** Deletes everything: the app is gone. */
  async clear(): Promise<void> {
    this.sql.exec("DELETE FROM docs");
    this.sql.exec("DELETE FROM owners");
    await this.ctx.storage.deleteAlarm();
  }

  private forget(user: string) {
    this.sql.exec("DELETE FROM docs WHERE user = ?", user);
    this.sql.exec("DELETE FROM owners WHERE user = ?", user);
  }

  private async touch(user: string, now: number, ttlMs: number) {
    this.sql.exec(
      "INSERT INTO owners (user, last_write, expires_at) VALUES (?, ?, ?) ON CONFLICT (user) DO UPDATE SET last_write = excluded.last_write, expires_at = excluded.expires_at",
      user, now, now + ttlMs,
    );
    await this.schedule();
  }

  // The alarm fires at the earliest expiry.
  private async schedule() {
    const [next] = this.sql.exec<{ at: number | null }>("SELECT min(expires_at) AS at FROM owners").toArray();
    if (next?.at == null) await this.ctx.storage.deleteAlarm();
    else if ((await this.ctx.storage.getAlarm()) !== next.at) await this.ctx.storage.setAlarm(next.at);
  }

  private find(user: string, collection: string, id: string) {
    const [row] = this.sql
      .exec<Row>("SELECT id, data, created_at, updated_at, created_by, updated_by FROM docs WHERE user = ? AND collection = ? AND id = ?", user, collection, id)
      .toArray();
    return row ? toDoc(row) : undefined;
  }

  private id(req: DataRequest): string {
    if (typeof req.id !== "string" || !req.id) throw new DataError("id is required");
    return req.id;
  }

  private doc(req: DataRequest): Record<string, unknown> {
    const doc = req.doc;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new DataError("doc must be a JSON object");
    const { id: _i, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...fields } = doc;
    if (JSON.stringify(fields).length > MAX_DOC_BYTES) throw new DataError("doc is larger than 64 KB");
    return fields;
  }
}

// Shared documents also say who created and last changed them; private ones are all the user's.
function toDoc(row: Row): Record<string, unknown> {
  const doc = { ...(JSON.parse(row.data) as Record<string, unknown>), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  return row.created_by ? { ...doc, createdBy: row.created_by, updatedBy: row.updated_by ?? row.created_by } : doc;
}

export const AppData = defineDurableObject({ name: "app-data", class: AppDataObject });
export default AppData;
