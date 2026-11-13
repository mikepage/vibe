// The app half of the vibe kit: createApp(), the signed-in user and the data client.
// Only generated apps import this (as part of "vibe:app"); the platform injects it
// into every build along with components.tsx and the compiled stylesheet ("vibe:css").

import { Hono } from "hono";
import css from "vibe:css";

export type User = { email: string };

/** A stored document: your fields plus id and timestamps (milliseconds). */
export type Doc<T> = T & { id: string; createdAt: number; updatedAt: number };

export interface Collection<T extends Record<string, unknown>> {
  /** Stores a new document and returns it with its id. */
  insert(doc: T): Promise<Doc<T>>;
  /** The signed-in user's documents, newest first. Default limit 100, max 1000. */
  list(options?: { limit?: number }): Promise<Doc<T>[]>;
  get(id: string): Promise<Doc<T> | null>;
  /** Merges `patch` into the document. Returns null if it doesn't exist. */
  update(id: string, patch: Partial<T>): Promise<Doc<T> | null>;
  /** Returns true if the document existed. */
  delete(id: string): Promise<boolean>;
}

export interface Data {
  /** A named collection of JSON documents, private to the signed-in user. */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<T>;
}

/** A shared document also says who created it and who changed it last (emails). */
export type SharedDoc<T> = Doc<T> & { createdBy: string; updatedBy: string };

export interface SharedCollection<T extends Record<string, unknown>> {
  insert(doc: T): Promise<SharedDoc<T>>;
  /** Everyone's documents, newest first. Default limit 100, max 1000. */
  list(options?: { limit?: number }): Promise<SharedDoc<T>[]>;
  get(id: string): Promise<SharedDoc<T> | null>;
  update(id: string, patch: Partial<T>): Promise<SharedDoc<T> | null>;
  delete(id: string): Promise<boolean>;
}

export interface SharedData {
  /**
   * A named collection of JSON documents shared by everyone who can open the app: they all
   * read and change the same documents. It never expires.
   */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): SharedCollection<T>;
}

export type VibeEnv = {
  Bindings: { VIBE: Fetcher };
  Variables: { user: User; data: Data; shared: SharedData };
};

function dataClient(binding: Fetcher, space: "private" | "shared"): Data & SharedData {
  const call = async (op: string, body: Record<string, unknown>) => {
    const res = await binding.fetch("https://platform/internal/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, space, ...body }),
    });
    if (!res.ok) throw new Error(`data.${op}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  return {
    collection: <T extends Record<string, unknown>>(collection: string) => ({
      insert: (doc: T) => call("insert", { collection, doc }) as Promise<SharedDoc<T>>,
      list: (options?: { limit?: number }) => call("list", { collection, limit: options?.limit }) as Promise<SharedDoc<T>[]>,
      get: (id: string) => call("get", { collection, id }) as Promise<SharedDoc<T> | null>,
      update: (id: string, patch: Partial<T>) => call("update", { collection, id, doc: patch }) as Promise<SharedDoc<T> | null>,
      delete: (id: string) => call("delete", { collection, id }) as Promise<boolean>,
    }),
  };
}

/**
 * A Hono app with the kit wired in: c.var.user is the signed-in user, c.var.data the
 * user's own JSON collections, c.var.shared the ones everyone who can open the app shares, HTML pages get the app's CSS
 * (its Tailwind classes on Nuxt UI's tokens) (the platform adds vibe's top bar), and errors show their stack.
 */
export function createApp() {
  const app = new Hono<VibeEnv>();
  app.use(async (c, next) => {
    c.set("user", { email: c.req.header("x-vibe-user") ?? "" });
    c.set("data", dataClient(c.env.VIBE, "private"));
    c.set("shared", dataClient(c.env.VIBE, "shared"));
    await next();
    if (!c.res.headers.get("content-type")?.startsWith("text/html")) return;
    // The app is served under /apps/<id>/, so relative links resolve against <base>.
    const base = c.req.header("x-vibe-base") ?? "/";
    const html = (await c.res.text()).replace("</head>", `<base href="${base}"><style>${css}</style></head>`);
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(html, { status: c.res.status, headers });
  });
  app.onError((err, c) => c.text(String(err.stack ?? err), 500));
  return app;
}
