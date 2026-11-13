// Measures the built platform (dist/ssr) in workerd, through Wrangler's test harness:
// build time, first and warm request, and workerd's memory, including the cost of one
// isolate per user. Builds first, as the tests do (test/build.ts). Writes results/measurements.json.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import build from "../test/build.ts";
import { accessTeam, fakeClaude, NOTES_APP, sign, startPlatform } from "../test/helpers.ts";

await build();

const RUNS = 5;
const USERS = 50;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const range = (xs: number[]) => `${Math.min(...xs)}–${Math.max(...xs)}`;

// Resident memory of the workerd processes this script started, in MB.
function workerdMb(): number {
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], { encoding: "utf8" });
  const rows = out.trim().split("\n").map((l) => l.trim().split(/\s+/));
  const mine = new Set([String(process.pid)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (mine.has(ppid) && !mine.has(pid)) {
        mine.add(pid);
        grew = true;
      }
    }
  }
  const kb = rows.filter(([pid, , , comm]) => mine.has(pid) && comm?.includes("workerd")).reduce((s, [, , rss]) => s + Number(rss), 0);
  return Math.round(kb / 1024);
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - start)];
}

const team = await accessTeam();
const claude = await fakeClaude();
const p = await startPlatform({ certsUrl: team.certsUrl, claudeUrl: claude.url });
const owner = await sign(team.privateKey, { email: "owner@example.com" });
const results: Record<string, unknown> = { date: new Date().toISOString(), runs: RUNS, users: USERS };

// Warm the platform itself (first request compiles the platform's CSS, opens D1).
await p.request("/", { token: owner, headers: { accept: "text/html" } });
results.memoryIdleMb = workerdMb();

const notes = { "index.tsx": NOTES_APP };
const npmApp = {
  "package.json": JSON.stringify({ dependencies: { zod: "4.6.7", marked: "18.2.0" } }),
  "index.tsx": `import { z } from "zod";
import { marked } from "marked";
import { raw } from "hono/html";
import { createApp, Page, Card } from "vibe:app";
const Note = z.object({ text: z.string().min(1) });
const app = createApp();
app.get("/", (c) => c.html(<Page title="Markdown"><Card>{raw(marked.parse("# Hello\\n\\n" + Note.parse({ text: "**zod** ok" }).text) as string)}</Card></Page>));
export default app;`,
};

async function deploySeries(name: string, files: Record<string, string>) {
  const created = await p.request("/api/apps", { token: owner, json: { name } });
  const id: string = created.data.app.id;
  await p.request(`/api/apps/${id}/sharing`, { token: owner, method: "PUT", json: { visibility: "everyone" } });
  const builds: number[] = [];
  const deploys: number[] = [];
  const first: number[] = [];
  const warm: number[] = [];
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    // A comment changes the source, so each run is a new version and a new isolate.
    const changed = { ...files, "index.tsx": `${files["index.tsx"]}\n// run ${i}` };
    const [res, ms] = await timed(() => p.request(`/api/apps/${id}/deploy`, { token: owner, json: { files: changed } }));
    if (res.status !== 200) throw new Error(`${name}: ${res.text}`);
    builds.push(res.data.buildMs);
    deploys.push(ms);
    bytes = res.data.bytes;
    const [, f] = await timed(() => p.request(`/apps/${id}/`, { token: owner }));
    first.push(f);
    for (let j = 0; j < 20; j++) warm.push((await timed(() => p.request(`/apps/${id}/`, { token: owner })))[1]);
  }
  return { id, buildMs: builds, deployMs: deploys, firstRequestMs: first, warmRequestMedianMs: median(warm), warmRequestMs: range(warm), bundleKb: Math.round(bytes / 1024) };
}

results.notes = await deploySeries("Notes", notes);
results.memoryAfterBuildsMb = workerdMb();
results.npm = await deploySeries("Markdown", npmApp);

// One isolate per user: open the notes app as USERS different people.
const notesId = (results.notes as { id: string }).id;
const before = workerdMb();
const perUserFirst: number[] = [];
for (let i = 0; i < USERS; i++) {
  const token = await sign(team.privateKey, { email: `user${i}@example.com` });
  perUserFirst.push((await timed(() => p.request(`/apps/${notesId}/`, { token })))[1]);
}
const after = workerdMb();
results.perUser = { firstRequestMedianMs: median(perUserFirst), memoryBeforeMb: before, memoryAfterMb: after, mbPerIsolate: Math.round(((after - before) / USERS) * 10) / 10 };

mkdirSync("results", { recursive: true });
writeFileSync("results/measurements.json", JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));

await p.close();
team.close();
claude.close();
