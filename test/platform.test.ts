import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessTeam, fakeClaude, fence, newKey, NOTES_APP, sign, sseEvents, startPlatform, type Platform } from "./helpers.ts";

let team: Awaited<ReturnType<typeof accessTeam>>;
let claude: Awaited<ReturnType<typeof fakeClaude>>;
let p: Platform;
let ada: string;
let grace: string;

const TTL_SECONDS = 3;

beforeAll(async () => {
  team = await accessTeam();
  claude = await fakeClaude();
  p = await startPlatform({ certsUrl: team.certsUrl, claudeUrl: claude.url, ttlSeconds: TTL_SECONDS });
  ada = await sign(team.privateKey, { email: "ada@example.com" });
  grace = await sign(team.privateKey, { email: "Grace@Example.com" });
});

afterAll(async () => {
  await p?.close();
  team?.close();
  claude?.close();
});

async function newApp(token: string, name: string, files: Record<string, string> = { "index.tsx": NOTES_APP }) {
  const created = await p.request("/api/apps", { token, json: { name } });
  expect(created.status).toBe(201);
  const id: string = created.data.app.id;
  const deployed = await p.request(`/api/apps/${id}/deploy`, { token, json: { files } });
  return { id, deployed };
}

describe("Access", () => {
  it("refuses requests without a token", async () => {
    expect((await p.request("/api/apps")).status).toBe(401);
  });

  it("accepts a valid token", async () => {
    expect((await p.request("/api/apps", { token: ada })).status).toBe(200);
  });

  it("refuses a token signed by another key", async () => {
    const forged = await sign(await newKey(), { email: "ada@example.com" });
    expect((await p.request("/api/apps", { token: forged })).status).toBe(401);
  });

  it("refuses the wrong audience, issuer or an expired token", async () => {
    const wrongAud = await sign(team.privateKey, { email: "ada@example.com" }, { audience: "other-app" });
    const wrongIss = await sign(team.privateKey, { email: "ada@example.com" }, { issuer: "https://evil.cloudflareaccess.com" });
    const expired = await sign(team.privateKey, { email: "ada@example.com" }, { expiresAt: Math.floor(Date.now() / 1000) - 120 });
    for (const token of [wrongAud, wrongIss, expired]) expect((await p.request("/api/apps", { token })).status).toBe(401);
  });

  it("refuses service tokens, which name no person", async () => {
    const service = await sign(team.privateKey, { common_name: "ci.access" });
    const res = await p.request("/api/apps", { token: service });
    expect(res.status).toBe(401);
    expect(res.data.code).toBe("ACCESS_REQUIRED");
  });

  it("makes Access's token the session, with no passwords", async () => {
    const me = await p.request("/api/auth/get-session", { token: ada });
    expect(me.data.user).toMatchObject({ email: "ada@example.com", emailVerified: true });
    const signUp = await p.request("/api/auth/sign-up/email", { token: ada, json: { email: "x@example.com", password: "correct horse battery staple", name: "x" } });
    expect(signUp.status).toBe(403);
    // A session cookie alone doesn't get past Access.
    const cookie = me.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await p.request("/api/apps", { headers: { cookie } })).status).toBe(401);
  });

  it("renders the pages with Nuxt UI, and sends the sign-in page on", async () => {
    const home = await p.request("/", { token: ada, headers: { accept: "text/html" } });
    expect(home.status).toBe(200);
    expect(home.text).toContain('class="sidebar ');
    // Nuxt UI's tokens, and its icons drawn on the server.
    expect(home.text).toContain("text-highlighted");
    expect(home.text).toMatch(/<svg[^>]*class="[^"]*iconify/);
    expect(home.text).toContain("ada@example.com");
    expect((await p.request("/teams", { token: ada })).status).toBe(200);
    expect((await p.request("/sign-in", { token: ada })).headers.get("location")).toBe("/");
  });

  it("refuses cross-origin and non-JSON writes to the API", async () => {
    const cross = await p.request("/api/apps", { token: ada, json: { name: "x" }, headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const form = await p.request("/api/apps", { token: ada, form: { name: "x" } });
    expect(form.status).toBe(415);
  });
});

describe("build loop", () => {
  it("feeds failures back to the model and stores the version that answers", async () => {
    claude.requests.length = 0;
    claude.replies.push(
      // 1: imports a package it didn't list.
      fence({ "index.tsx": `import { z } from "zod";\nimport { createApp, Page } from "vibe:app";\nconst app = createApp();\napp.get("/", (c) => c.html(<Page title="x">{String(z)}</Page>));\nexport default app;` }),
      // 2: builds, but GET / throws.
      fence({ "index.tsx": `import { createApp } from "vibe:app";\nconst app = createApp();\napp.get("/", () => { throw new Error("boom on purpose"); });\nexport default app;` }),
      // 3: works.
      fence({ "index.tsx": NOTES_APP }),
    );
    const res = await p.request("/api/apps", { token: ada, json: { name: "Generated notes", prompt: "A notes app." } });
    expect(res.status, res.text).toBe(201);
    expect(res.data.attempts).toBe(3);
    expect(res.data.version).toBe(1);

    expect(claude.requests).toHaveLength(3);
    const lastUser = (i: number) => JSON.stringify(claude.requests[i].inputs.messages.at(-1));
    expect(lastUser(1)).toMatch(/not in package.json dependencies: zod/);
    expect(lastUser(2)).toMatch(/GET \/ answered 500/);
    expect(lastUser(2)).toMatch(/boom on purpose/);
    // The model's own reply goes back before each failure.
    expect(claude.requests[2].inputs.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(claude.requests[0].model).toBe("anthropic/claude-opus-5.5");
    // Claude hears the app's network setting: none, by default.
    expect(JSON.stringify(claude.requests[0].inputs.messages[0])).toContain("Network: none");
    expect(claude.requests[0].options.gateway?.id).toBe("default");

    const page = await p.request(`/apps/${res.data.app.id}/`, { token: ada });
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Notes</title>");
  });

  it("stores nothing after three failed attempts", async () => {
    const broken = fence({ "index.tsx": `export default {` });
    claude.replies.push(broken, broken, broken);
    const res = await p.request("/api/apps", { token: ada, json: { name: "Broken", prompt: "Anything." } });
    expect(res.status).toBe(422);
    expect(res.data.steps.filter((s: { step: string }) => s.step === "error")).toHaveLength(3);
    const app = await p.request(`/api/apps/${res.data.app.id}`, { token: ada });
    expect(app.data.app.currentVersion).toBeNull();
    expect(app.data.versions).toHaveLength(0);
  });

  it("styles app pages with the kit's Tailwind classes on Nuxt UI's tokens", async () => {
    const { id } = await newApp(ada, "Styled");
    const page = await p.request(`/apps/${id}/`, { token: ada });
    expect(page.text).toMatch(/<style>[^<]*\.min-h-screen/);
    // The kit's Button, as Nuxt UI's solid primary, and the token it uses in the CSS.
    expect(page.text).toContain("bg-primary text-inverted");
    expect(page.text).toMatch(/--ui-primary: ?var\(--color-green-500\)/);
    expect(page.text).toMatch(/\.bg-primary ?\{[^}]*var\(--ui-primary\)/);
    await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "a row" } });
    expect((await p.request(`/apps/${id}/`, { token: ada })).text).toMatch(/<div class="vibe-table [^"]*"><table/);
    expect(page.text).toContain(`<base href="/apps/${id}/">`);
    // vibe's top bar: back to vibe, the app's page there, the user.
    expect(page.text).toMatch(/<body[^>]*><header class="vibe-topbar">/);
    expect(page.text).toContain(`<a href="/build/${id}" class="vibe-current" aria-current="page" target="_top">Styled</a>`);
    expect(page.text).toContain("ada@example.com");
    // Everything is inline: no stylesheet to fetch.
    expect(page.text).not.toContain('<link rel="stylesheet"');
  });

  it("compiles Tailwind classes with commas in their arbitrary values", async () => {
    const { id, deployed } = await newApp(ada, "Grids", {
      "index.tsx": `import { createApp, Page } from "vibe:app";\nconst app = createApp();\nconst f = (a: number, b: number) => a + b;\napp.get("/", (c) => c.html(<Page title="x"><div class="grid grid-cols-[13rem_minmax(0,1fr)]">{f(1, 2)}</div><div class="grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]" /></Page>));\nexport default app;`,
    });
    expect(deployed.status).toBe(200);
    const page = await p.request(`/apps/${id}/`, { token: ada });
    const styles = [...page.text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    expect(styles).toContain("grid-template-columns: 13rem minmax(0,1fr)");
    expect(styles).toContain("grid-template-columns: repeat(auto-fill,minmax(14rem,1fr))");
  });

  it("gives apps no internet", async () => {
    const { deployed } = await newApp(ada, "Fetcher", {
      "index.tsx": `import { createApp, Page } from "vibe:app";\nconst app = createApp();\napp.get("/", async (c) => { await fetch("https://example.com/"); return c.html(<Page title="x">reached</Page>); });\nexport default app;`,
    });
    expect(deployed.status).toBe(422);
    expect(deployed.data.error).toMatch(/not permitted to access the internet/);
  });
});

describe("network setting", () => {
  // A stand-in for the internet on 127.0.0.1; "localhost" reaches the same server under another name.
  const outside = createServer((_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("hello from outside"));
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((ok) => outside.listen(0, "127.0.0.1", ok));
    port = (outside.address() as AddressInfo).port;
  });
  afterAll(() => outside.close());

  // GET / always answers; /fetch?u=<url> fetches it and reports what came back.
  const FETCHER = `import { createApp, Page } from "vibe:app";
const app = createApp();
app.get("/", (c) => c.html(<Page title="x">ok</Page>));
app.get("/fetch", async (c) => {
  try {
    const res = await fetch(c.req.query("u")!);
    return c.json({ status: res.status, body: await res.text() });
  } catch (e) {
    return c.json({ error: String(e) });
  }
});
export default app;`;

  it("is disabled until the owner allows a list or everything", async () => {
    const { id } = await newApp(ada, "Network", { "index.tsx": FETCHER });
    const get = async (host: string) => (await p.request(`/apps/${id}/fetch?u=${encodeURIComponent(`http://${host}:${port}/`)}`, { token: ada })).data;
    const network = (json: unknown) => p.request(`/api/apps/${id}/outbound`, { token: ada, method: "PUT", json });

    expect((await get("127.0.0.1")).error).toMatch(/not permitted to access the internet/);

    expect((await network({ mode: "allowlist", hosts: ["127.0.0.1"] })).status).toBe(200);
    expect(await get("127.0.0.1")).toEqual({ status: 200, body: "hello from outside" });
    const refused = await get("localhost");
    expect(refused.status).toBe(403);
    expect(refused.body).toMatch(/may not fetch localhost/);

    expect((await network({ mode: "all" })).status).toBe(200);
    expect((await get("localhost")).body).toBe("hello from outside");

    expect((await network({ mode: "disabled" })).status).toBe(200);
    expect((await get("127.0.0.1")).error).toMatch(/not permitted/);
  });

  it("takes only host names, and only from the owner", async () => {
    const { id } = await newApp(ada, "Network rules", { "index.tsx": FETCHER });
    const network = (token: string, json: unknown) => p.request(`/api/apps/${id}/outbound`, { token, method: "PUT", json });
    expect((await network(ada, { mode: "allowlist", hosts: ["https://example.com/x"] })).status).toBe(400);
    expect((await network(ada, { mode: "allowlist", hosts: [] })).status).toBe(400);
    expect((await network(ada, { mode: "open" })).status).toBe(400);
    expect((await network(ada, { mode: "allowlist", hosts: "api.example.com\n*.example.org" })).data.hosts).toEqual(["api.example.com", "*.example.org"]);
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    expect((await network(grace, { mode: "all" })).status).toBe(403);
  });
});

describe("sharing", () => {
  it("keeps apps private until shared with a team or everyone", async () => {
    const { id } = await newApp(ada, "Shared notes");
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(404);
    expect((await p.request(`/api/apps/${id}`, { token: grace })).status).toBe(404);

    const t = await p.request("/api/teams", { token: ada, json: { name: "Finance" } });
    // Can't share with a team you're not in.
    const other = await p.request("/api/teams", { token: grace, json: { name: "Grace only" } });
    expect((await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "teams", teamIds: [other.data.id] } })).status).toBe(403);

    await p.request(`/api/teams/${t.data.id}/members`, { token: ada, json: { email: "grace@example.com" } });
    const shared = await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "teams", teamIds: [t.data.id] } });
    expect(shared.status).toBe(200);
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(200);
    expect((await p.request("/api/apps", { token: grace })).data.shared.map((a: { id: string }) => a.id)).toContain(id);

    // Only the owner changes the app.
    expect((await p.request(`/api/apps/${id}/deploy`, { token: grace, json: { files: { "index.tsx": NOTES_APP } } })).status).toBe(403);

    await p.request(`/api/teams/${t.data.id}/members`, { token: ada, method: "DELETE", json: { email: "grace@example.com" } });
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(404);

    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(200);

    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "private" } });
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(404);
  });
});

describe("ownership", () => {
  it("passes to someone who has signed in, from the owner only", async () => {
    const { id } = await newApp(ada, "Handover");
    const transfer = (token: string, email: string) => p.request(`/api/apps/${id}/owner`, { token, method: "PUT", json: { email } });
    expect((await transfer(ada, "not an email")).status).toBe(400);
    expect((await transfer(ada, "nobody@example.com")).status).toBe(404);
    // Grace has signed in (earlier tests), but can't take an app that isn't hers.
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    expect((await transfer(grace, "grace@example.com")).status).toBe(403);

    expect((await transfer(ada, "Grace@Example.com")).data.owner).toBe("grace@example.com");
    expect((await p.request(`/api/apps/${id}`, { token: grace })).data.app.ownerEmail).toBe("grace@example.com");
    expect((await p.request(`/api/apps/${id}/deploy`, { token: grace, json: { files: { "index.tsx": NOTES_APP } } })).status).toBe(200);
    expect((await p.request(`/api/apps/${id}/deploy`, { token: ada, json: { files: { "index.tsx": NOTES_APP } } })).status).toBe(403);
    expect((await p.request("/api/apps", { token: ada })).data.shared.map((a: { id: string }) => a.id)).toContain(id);
  });
});

describe("super admin", () => {
  it("manages every app, its data, every team and the roles", async () => {
    const root = await sign(team.privateKey, { email: "root@example.com" });
    // Signed in once, then made admin the way the first admin is made: in D1.
    expect((await p.request("/admin", { token: root })).status).toBe(404);
    const env = await p.harness.getWorker<{ DB: D1Database }>().getEnv();
    await env.DB.prepare("UPDATE user SET role = 'admin' WHERE email = 'root@example.com'").run();

    // Ada's private app, with data in it.
    const { id } = await newApp(ada, "Ada's private notes");
    await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "ada's own" } });
    expect((await p.request(`/apps/${id}/`, { token: grace })).status).toBe(404);

    // Everything an owner can.
    expect((await p.request("/admin", { token: root })).text).toContain("Ada&#39;s private notes");
    expect((await p.request(`/build/${id}`, { token: root })).text).toContain("as a super admin");
    expect((await p.request(`/apps/${id}/`, { token: root })).status).toBe(200);
    expect((await p.request(`/api/apps/${id}/deploy`, { token: root, json: { files: { "index.tsx": NOTES_APP } } })).status).toBe(200);
    expect((await p.request(`/api/apps/${id}/outbound`, { token: root, method: "PUT", json: { mode: "disabled" } })).status).toBe(200);

    // The data inside: every space, every document, and deleting.
    const data = `/api/admin/apps/${id}/data`;
    const spaces = (await p.request(data, { token: root })).data.spaces;
    expect(spaces).toEqual([expect.objectContaining({ user: "ada@example.com", docs: 1, collections: ["notes"] })]);
    const docs = (await p.request(`${data}?user=ada@example.com`, { token: root })).data.docs;
    expect(docs).toEqual([expect.objectContaining({ collection: "notes", text: "ada's own" })]);
    expect((await p.request(data, { token: root, method: "DELETE", json: { user: "ada@example.com", collection: "notes", id: docs[0].id } })).data.deleted).toBe(1);
    expect((await p.request(`/apps/${id}/api/notes`, { token: ada })).data).toEqual([]);
    await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "again" } });
    expect((await p.request(data, { token: root, method: "DELETE", json: { user: "ada@example.com" } })).data.deleted).toBe(1);
    expect((await p.request(data, { token: root })).data.spaces).toEqual([]);

    // Teams they're not in.
    const t = (await p.request("/api/teams", { token: grace, json: { name: "Grace's team" } })).data;
    expect((await p.request(`/api/teams/${t.id}/members`, { token: root, json: { email: "bob@example.com" } })).status).toBe(201);
    expect((await p.request("/admin/teams", { token: root })).text).toContain("bob@example.com");
    expect((await p.request(`/api/admin/teams/${t.id}`, { token: root, method: "DELETE", json: {} })).status).toBe(200);
    expect((await p.request("/api/teams", { token: grace })).data.teams.map((x: { id: string }) => x.id)).not.toContain(t.id);

    // Roles: others, not themselves.
    const usersPage = await p.request("/admin/users", { token: root });
    expect(usersPage.text).toContain("Make super admin");
    const idOf = async (email: string) => (await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>())!.id;
    const graceId = await idOf("grace@example.com");
    const rootId = await idOf("root@example.com");
    expect((await p.request(`/api/admin/users/${graceId}/role`, { token: root, method: "PUT", json: { role: "admin" } })).status).toBe(200);
    expect((await p.request("/admin", { token: grace })).status).toBe(200);
    expect((await p.request(`/api/admin/users/${graceId}/role`, { token: root, method: "PUT", json: { role: "user" } })).status).toBe(200);
    expect((await p.request(`/api/admin/users/${rootId}/role`, { token: root, method: "PUT", json: { role: "user" } })).status).toBe(400);

    // Nobody else gets any of it.
    expect((await p.request("/admin", { token: grace })).status).toBe(404);
    expect((await p.request(data, { token: grace })).status).toBe(403);
    expect((await p.request(`/api/admin/users/${graceId}/role`, { token: ada, method: "PUT", json: { role: "admin" } })).status).toBe(403);
  });
});

describe("app data", () => {
  it("keeps each user's data separate", async () => {
    const { id } = await newApp(ada, "Data notes");
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });

    const added = await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "ada's secret" } });
    expect(added.status).toBe(302);
    expect(added.headers.get("location")).toBe(`/apps/${id}/`);
    await p.request(`/apps/${id}/notes`, { token: grace, form: { text: "grace's note" } });

    const adaNotes = (await p.request(`/apps/${id}/api/notes`, { token: ada })).data;
    const graceNotes = (await p.request(`/apps/${id}/api/notes`, { token: grace })).data;
    expect(adaNotes.map((n: { text: string }) => n.text)).toEqual(["ada's secret"]);
    expect(graceNotes.map((n: { text: string }) => n.text)).toEqual(["grace's note"]);

    // Grace can't reach Ada's note by id either.
    const del = await p.request(`/apps/${id}/notes/${adaNotes[0].id}/delete`, { token: grace, form: {} });
    expect(del.status).toBe(302);
    expect((await p.request(`/apps/${id}/api/notes`, { token: ada })).data).toHaveLength(1);
  });

  it("ignores a user the app names itself", async () => {
    const { id } = await newApp(ada, "Sneaky", {
      "index.tsx": `import { createApp, Page } from "vibe:app";
const app = createApp();
app.get("/", (c) => c.html(<Page title="x">ok</Page>));
app.get("/peek", async (c) => {
  const res = await c.env.VIBE.fetch("https://platform/internal/data", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": "x" },
    body: JSON.stringify({ op: "list", collection: "notes", user: "ada@example.com", userEmail: "ada@example.com", appId: "other" }),
  });
  return c.json(await res.json());
});
app.post("/write", async (c) => c.json(await c.var.data.collection("notes").insert({ text: "mine" })));
export default app;`,
    });
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    await p.request(`/apps/${id}/write`, { token: ada, form: {} });
    expect((await p.request(`/apps/${id}/peek`, { token: ada })).data).toHaveLength(1);
    expect((await p.request(`/apps/${id}/peek`, { token: grace })).data).toEqual([]);
  });

  // A team list: everyone who can open the app adds to and reads the same documents.
  const TEAM = `import { createApp, Page } from "vibe:app";
const app = createApp();
app.get("/", (c) => c.html(<Page title="x">ok</Page>));
app.post("/add", async (c) => c.json(await c.var.shared.collection("birthdays").insert({ name: String((await c.req.parseBody()).name) })));
app.get("/all", async (c) => c.json(await c.var.shared.collection("birthdays").list()));
app.post("/rename/:id", async (c) => c.json(await c.var.shared.collection("birthdays").update(c.req.param("id"), { name: "renamed" })));
app.get("/mine", async (c) => c.json(await c.var.data.collection("birthdays").list()));
export default app;`;

  it("shares data in c.var.shared with everyone who can open the app", async () => {
    const { id } = await newApp(ada, "Team birthdays", { "index.tsx": TEAM });
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    const added = (await p.request(`/apps/${id}/add`, { token: ada, form: { name: "Ada" } })).data;
    expect(added).toMatchObject({ name: "Ada", createdBy: "ada@example.com", updatedBy: "ada@example.com" });
    await p.request(`/apps/${id}/add`, { token: grace, form: { name: "Grace" } });

    const seen = (await p.request(`/apps/${id}/all`, { token: grace })).data;
    expect(seen.map((d: { name: string }) => d.name).sort()).toEqual(["Ada", "Grace"]);
    // Anyone who can open the app may change a shared document; the app sees who did.
    expect((await p.request(`/apps/${id}/rename/${added.id}`, { token: grace, form: {} })).data).toMatchObject({ name: "renamed", createdBy: "ada@example.com", updatedBy: "grace@example.com" });
    // Private data stays apart from it.
    expect((await p.request(`/apps/${id}/mine`, { token: ada })).data).toEqual([]);

    // Deleting the app deletes its data too.
    const storage = await p.harness.getWorker().getDurableObjectStorage("APP_DATA", { name: id });
    const count = async () => ((await storage.exec("SELECT count(*) AS n FROM docs")) as { n: number }[])[0].n;
    expect(await count()).toBe(2);
    expect((await p.request(`/api/apps/${id}`, { token: ada, method: "DELETE", json: {} })).status).toBe(200);
    expect(await count()).toBe(0);
  });

  it("is not reachable from outside an app", async () => {
    const res = await p.request("/internal/data", { token: ada, json: { op: "list", collection: "notes" } });
    expect(res.status).toBe(404);
  });

  it("blocks scripts and cookies from app pages", async () => {
    const { id } = await newApp(ada, "Headers", {
      "index.tsx": `import { createApp, Page } from "vibe:app";\nconst app = createApp();\napp.get("/", (c) => { c.header("set-cookie", "app_cookie=1; Path=/"); return c.html(<Page title="x">ok</Page>); });\nexport default app;`,
    });
    const page = await p.request(`/apps/${id}/`, { token: ada });
    expect(page.status).toBe(200);
    // No script of the app's own: only vibe's, by its full URL (not 'self', which covers /apps/).
    const csp = page.headers.get("content-security-policy")!;
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1];
    expect(scriptSrc).toMatch(/^http:\/\/platform\.test\/kit\/vibe-[0-9a-f]{8}\.js$/);
    // The platform's own session cookie may come along; the app's never does.
    expect(page.headers.getSetCookie().some((c) => c.startsWith("app_cookie="))).toBe(false);
  });

  it(`expires a user's data ${TTL_SECONDS} s after their last write`, async () => {
    const { id } = await newApp(ada, "Expiring");
    await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "short-lived" } });
    const storage = await p.harness.getWorker().getDurableObjectStorage("APP_DATA", { name: id });
    const count = async (user = "ada@example.com") => ((await storage.exec("SELECT count(*) AS n FROM docs WHERE user = ?", user)) as { n: number }[])[0].n;
    // A shared document, as c.var.shared writes it, in the same object.
    await storage.exec("INSERT INTO docs (user, collection, id, data, created_at, updated_at, created_by) VALUES ('~shared', 'notes', 's1', '{}', 0, 0, 'ada@example.com')");
    expect(await count()).toBe(1);
    // The alarm deletes it without anyone reading; shared data stays.
    await new Promise((r) => setTimeout(r, (TTL_SECONDS + 2) * 1000));
    expect(await count()).toBe(0);
    expect(await count("~shared")).toBe(1);
    expect((await p.request(`/apps/${id}/api/notes`, { token: ada })).data).toEqual([]);
  });
});

describe("vibe's script", () => {
  it("is linked from every app page and is the one script the CSP allows", async () => {
    const { id } = await newApp(ada, "Scripted");
    const page = await p.request(`/apps/${id}/`, { token: ada });
    const src = /<script src="([^"]+)" defer><\/script><\/head>/.exec(page.text)?.[1];
    expect(src).toMatch(/^\/kit\/vibe-[0-9a-f]{8}\.js$/);
    expect(page.headers.get("content-security-policy")).toContain(`script-src http://platform.test${src};`);
    const script = await p.request(src!, { token: ada });
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(script.text).toContain("data-vibe-autosave");
    // Behind Access like everything else.
    expect((await p.request(src!)).status).toBe(401);
  });

  it("keeps panels in tables from being cut off", async () => {
    const files = {
      "index.tsx": `import { createApp, Page, Table, Popover, Button } from "vibe:app";
const app = createApp();
app.get("/", (c) => c.html(<Page title="Rows"><Table columns={["Name", ""]} rows={[["One", <Popover id="delete-1" label="Delete"><form method="post" action="delete/1"><Button variant="danger" size="sm">Yes, delete it</Button></form></Popover>]]} /></Page>));
export default app;`,
    };
    const { id, deployed } = await newApp(ada, "Popovers", files);
    expect(deployed.status, deployed.text).toBe(200);
    const page = await p.request(`/apps/${id}/`, { token: ada });
    // The kit's Popover: a native popover anchored to its button, drawn above the table.
    expect(page.text).toMatch(/<button type="button" popovertarget="delete-1" class="[^"]*rounded-md[^"]*" style="anchor-name:--vibe-pop-delete-1">Delete<\/button>/);
    expect(page.text).toMatch(/<div id="delete-1" popover="auto" style="position-anchor:--vibe-pop-delete-1" class="[^"]*\[position-area:bottom_span-left\]/);
    // Its Tailwind classes are in the app's CSS.
    expect(page.text).toContain("position-area: bottom span-left");
    // Apps that drop a <details> panel from a row get the table's overflow lifted while it's open.
    expect(page.text).toContain(".vibe-table:has(details[open]){overflow:visible}");
  });
});

describe("drafts", () => {
  const notes = async (path: string, token = ada) => (await p.request(`${path}api/notes`, { token })).data.map((n: { text: string }) => n.text);
  const draft = async (id: string, prompt: string) => {
    const res = await p.request(`/api/apps/${id}/draft`, { token: ada, json: { prompt } });
    expect(res.status, res.text).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    return sseEvents(res.text);
  };

  it("streams Claude's reply and the steps, and leaves the live version alone", async () => {
    const { id } = await newApp(ada, "Drafted notes");
    const working = fence({ "index.tsx": `${NOTES_APP}\n// draft 1` });
    claude.requests.length = 0;
    claude.replies.push(fence({ "index.tsx": "export default {" }), working);
    const events = await draft(id, "Add a marker.");

    expect(events.filter((e) => e.event === "attempt").map((e) => e.data.attempt)).toEqual([1, 2]);
    // The text arrives in pieces, and they add up to the reply.
    const texts = events.filter((e) => e.event === "text" && e.data.attempt === 2);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.map((e) => e.data.text).join("")).toBe(working);
    const steps = events.filter((e) => e.event === "step").map((e) => `${e.data.step.attempt} ${e.data.step.step}`);
    expect(steps).toEqual(["1 generate", "1 error", "2 generate", "2 build", "2 smoke"]);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.draft).toMatchObject({ prompts: ["Add a marker."], baseVersion: 1, attempts: 2 });

    // Claude was asked to stream, and its thinking went back with its signature.
    expect(claude.requests.every((r) => r.inputs.stream)).toBe(true);
    expect(claude.requests[1].inputs.messages[1].content).toContainEqual({ type: "thinking", thinking: "Planning the app.", signature: "sig-1" });

    const app = await p.request(`/api/apps/${id}`, { token: ada });
    expect(app.data.app.currentVersion).toBe(1);
    expect(app.data.versions).toHaveLength(1);
  });

  it("serves the draft to its owner, with data apart from the live app's, and iterates on it", async () => {
    const { id } = await newApp(ada, "Tried notes");
    await p.request(`/api/apps/${id}/sharing`, { token: ada, method: "PUT", json: { visibility: "everyone" } });
    await p.request(`/apps/${id}/notes`, { token: ada, form: { text: "live note" } });

    // No draft yet.
    expect((await p.request(`/apps/${id}/~draft/`, { token: ada })).status).toBe(404);
    claude.replies.push(fence({ "index.tsx": `${NOTES_APP}\n// draft 1` }));
    expect((await draft(id, "First change.")).at(-1)!.event).toBe("done");

    expect((await p.request(`/apps/${id}/~draft`, { token: ada })).headers.get("location")).toBe(`/apps/${id}/~draft/`);
    const page = await p.request(`/apps/${id}/~draft/`, { token: ada });
    expect(page.status).toBe(200);
    expect(page.text).toContain('class="vibe-draft"');
    // Only whoever may change the app tries its draft.
    expect((await p.request(`/apps/${id}/~draft/`, { token: grace })).status).toBe(404);
    expect((await p.request(`/api/apps/${id}/draft`, { token: grace, json: { prompt: "Mine now." } })).status).toBe(403);

    const added = await p.request(`/apps/${id}/~draft/notes`, { token: ada, form: { text: "draft note" } });
    expect(added.headers.get("location")).toBe(`/apps/${id}/~draft/`);
    expect(await notes(`/apps/${id}/~draft/`)).toEqual(["draft note"]);
    expect(await notes(`/apps/${id}/`)).toEqual(["live note"]);

    // A follow-up prompt changes the draft, not the live version.
    claude.requests.length = 0;
    claude.replies.push(fence({ "index.tsx": `${NOTES_APP}\n// draft 2` }));
    const done = (await draft(id, "Second change.")).at(-1)!;
    expect(done.data.draft.prompts).toEqual(["First change.", "Second change."]);
    expect(JSON.stringify(claude.requests[0].inputs.messages[0])).toContain("// draft 1");

    // Publishing makes it the next version, as one with both prompts, and the draft's data goes.
    const published = await p.request(`/api/apps/${id}/draft/publish`, { token: ada, json: {} });
    expect(published.status, published.text).toBe(200);
    expect(published.data.version).toBe(2);
    const app = await p.request(`/api/apps/${id}`, { token: ada });
    expect(app.data.app.currentVersion).toBe(2);
    expect(app.data.versions[0]).toMatchObject({ version: 2, prompt: "First change.\n\nSecond change.", attempts: 2 });
    expect(app.data.files["index.tsx"]).toContain("// draft 2");
    expect((await p.request(`/api/apps/${id}/draft`, { token: ada })).data.draft).toBeNull();
    expect((await p.request(`/apps/${id}/~draft/`, { token: ada })).status).toBe(404);
    expect(await notes(`/apps/${id}/`)).toEqual(["live note"]);

    // A new draft starts from v2 with no data; discarding it leaves v2.
    claude.replies.push(fence({ "index.tsx": `${NOTES_APP}\n// draft 3` }));
    expect((await draft(id, "Third change.")).at(-1)!.data.draft.baseVersion).toBe(2);
    expect(await notes(`/apps/${id}/~draft/`)).toEqual([]);
    await p.request(`/apps/${id}/~draft/notes`, { token: ada, form: { text: "thrown away" } });
    expect((await p.request(`/api/apps/${id}/draft`, { token: ada, method: "DELETE", json: {} })).status).toBe(200);
    expect((await p.request(`/apps/${id}/~draft/`, { token: ada })).status).toBe(404);
    expect((await p.request(`/api/apps/${id}`, { token: ada })).data.app.currentVersion).toBe(2);
    claude.replies.push(fence({ "index.tsx": `${NOTES_APP}\n// draft 4` }));
    await draft(id, "Fourth change.");
    expect(await notes(`/apps/${id}/~draft/`)).toEqual([]);
  });

  it("keeps no draft when no attempt works", async () => {
    const created = await p.request("/api/apps", { token: ada, json: { name: "Never drafted" } });
    const id = created.data.app.id;
    const broken = fence({ "index.tsx": "export default {" });
    claude.replies.push(broken, broken, broken);
    const last = (await draft(id, "Anything.")).at(-1)!;
    expect(last.event).toBe("failed");
    expect(last.data.error).toMatch(/No working app after 3 attempts/);
    expect(last.data.steps.filter((s: { step: string }) => s.step === "error")).toHaveLength(3);
    expect((await p.request(`/api/apps/${id}/draft`, { token: ada })).data.draft).toBeNull();
  });
});
