# vibe

A vibe-coding platform on Cloudflare Workers. People sign in through Cloudflare Access, describe an app, and Claude
writes it. The platform builds it with worker-bundler inside the Worker, checks that it answers, and runs it as a
Dynamic Worker through Worker Loader. No containers. Apps can be private, shared with a team, or shared with
everyone who passes Access. Each app stores JSON documents per user, and a user's data expires 14 days after their
last write.

A [Void](https://void.cloud) app: Vue pages on [Nuxt UI](https://ui.nuxt.com) (used in plain Vue through its Vite
plugin, not Nuxt), an API in Hono, and sign-in through Cloudflare Access on Void's Better Auth. No organizations:
sharing is vibe's own.

Written against Void 1.8.0 with `@void/vue` 1.8.0, Vite 8.3.8, Vue 3.5.44, Nuxt UI 4.12.0, Better Auth 1.7.22,
`@cloudflare/worker-bundler` 0.2.6, Hono 4.13.18, Tailwind 4.3.5 and Claude Opus 5.5 on Workers AI
(`anthropic/claude-opus-5.5`).

## Run it

Node 24.22 or later, pnpm 12.

```bash
pnpm install
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
pnpm dev           # → http://localhost:5173
```

`pnpm dev` applies the D1 migrations and starts Vite. Locally there is no Access: sign up with an email and a
password. Deploying hand-written files works right away. Generating apps calls Claude through the Workers AI binding
(`void/ai`), locally too: Workers AI has no local simulator, so dev uses the remote binding on the connected account.
Connect once:

```bash
npx void cloudflare login
npx void connect --platform cloudflare
```

There is no Anthropic key. `anthropic/claude-opus-5.5` is a third-party model on Workers AI: it runs through an AI
Gateway (`default`, created on first use) and is paid with Unified Billing credits on the account. `AI_MODEL` and
`AI_GATEWAY_ID` in `env.ts` change the model and gateway.

Open http://localhost:5173, sign up, and describe an app. **Sign out** and sign up as someone else to share an app
with a team and open it as a second person.

```bash
pnpm test          # builds dist/ and runs the tests against it in workerd, behind a stand-in for Access
pnpm check         # vite build, then tsc for the Worker and for the Node side
pnpm lint          # ESLint (tools/lint, on TypeScript 6)
pnpm measure       # the numbers below; writes results/measurements.json
```

From a script, against a deployment with an Access token (`cloudflared access token --app=https://vibe.example.com`):

```bash
curl -H "cf-access-jwt-assertion: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Expenses","prompt":"Track expenses with a date, amount and category."}' https://vibe.example.com/api/apps
curl -H "cf-access-jwt-assertion: $TOKEN" -H 'content-type: application/json' \
  -d "{\"files\":{\"index.tsx\":$(jq -Rs . < examples/notes/index.tsx)}}" https://vibe.example.com/api/apps/<id>/deploy
```

## How it works

```
browser ─ Access ─▶ platform Worker (Void; pages in Vue + Nuxt UI, API in Hono)
                     ├─ D1: Better Auth's user and session, teams, team_members, apps, shares, versions
                     ├─ R2: each version's source and bundle
                     ├─ Builder Durable Object: worker-bundler + Tailwind, apart from request serving
                     ├─ Claude: Workers AI binding → AI Gateway, paid with Unified Billing
                     └─ Worker Loader ─▶ app isolate per (app, version, user), globalOutbound: null
                                           └─ VIBE binding ─▶ /internal/data ─▶ AppData Durable Object (SQLite)
```

**Sign-in.** Void's Better Auth with a Cloudflare Access plugin (`auth.ts`, `lib/cloudflare-access-plugin.ts`,
settings in `lib/cloudflare-access.ts`). With `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set, the plugin verifies
`Cf-Access-Jwt-Assertion` with WebCrypto (`crypto.subtle`, RS256 against the team's keys, then `aud`, `iss`, `exp`,
`nbf`; no JWT library), finds or creates the user by the token's email, and makes that the session.
Password sign-in and sign-up are off. `middleware/00.cloudflare-access.ts` answers 401 to every request without a
valid token, a session cookie included; a service token names no person and gets the same 401. The one exception is
an app's own `VIBE` binding (below), which carries props no outside request can.

Unset, as in local dev, people sign up with an email and a password (`pages/sign-in.vue`, `pages/sign-up.vue`).
`middleware/01.session.ts` sends signed-out page views there and answers the API with 401.

**Building.** `POST /api/apps/:id/generate` sends the prompt and the current files to Claude through the Workers AI binding. The system prompt
(`lib/prompt.ts`) explains the rules and includes the kit's source, so the model uses the components it can see.
Then, up to three times:

1. Parse the files from the reply.
2. Check them: an entry file, and every bare import listed in `package.json` (`lib/checks.ts`).
3. Build them in the Builder Durable Object: Tailwind for the classes in the app and the kit, then worker-bundler.
4. Start the bundle as a Dynamic Worker and request `GET /` as a throwaway user.
5. Any failure goes back to Claude as the next message.

A version is stored only after `GET /` answers below 400. `POST /api/apps/:id/deploy` takes hand-written files
through steps 2 to 4.

**Drafts.** The build page doesn't change the live version. Its prompts go to `POST /api/apps/:id/draft`, which runs
the same loop with `stream: true` and answers with Server-Sent Events (`void/sse`): `attempt`, `text` (Claude's
reply as it arrives), `step`, then `done` or `failed`. The page shows the reply and which file Claude is writing, and
the draft that answered in a frame. A draft is one per app (`drafts` in D1, its files and bundle in R2 under
`apps/<id>/draft/`). Follow-up prompts change the draft, not the live version.

The owner tries it at `/apps/<id>/~draft/`, under the app's own path so the CSP and vibe's script treat it as the app.
It runs against its own data space, `<id>~draft`, never the app's. **Publish** (`POST /api/apps/:id/draft/publish`)
stores the draft as the next version as it was built and tested, with its prompts as the version's prompt;
**Discard** (`DELETE /api/apps/:id/draft`) drops it. Both clear the draft's data. `POST /api/apps` with a prompt and
`POST /api/apps/:id/generate` still store a version directly, for scripts.

**The kit.** Every app imports from `vibe:app`: `createApp()`, `c.var.user`, `c.var.data`, and the components in
`kit/components.tsx` (Page, NavBar, Header, Card, Stack, Row, Button, Input, Textarea, Select, Checkbox, Field, Form,
Table, Badge, Alert, EmptyState, Stat, and for richer forms Chips, Switch, Range, ColorInput, SaveStatus, Live,
CopyButton, and Popover for a confirmation or small form beside a button, drawn above tables and cards). `vibe:app` is a virtual module the builder adds to each build, so the kit is
one copy, not a template the model edits.

Apps can't run scripts of their own, so they can't use Nuxt UI's Vue components. The kit's components are Tailwind
classes drawn to match them (UButton, UCard, UTable, UInput, UBadge, UAlert, UEmpty, USwitch), on Nuxt UI's tokens:
`kit/theme.css` defines `text-muted`, `bg-elevated`, `ring-default`, `bg-primary` and the rest with the same names and
colors as the platform's pages (primary green, neutral slate). Apps are light only.

The platform puts vibe's top bar above every HTML page an app answers (`lib/topbar.ts`, from `forward()` in
`lib/runtime.ts`): home and Apps back to vibe, the app's name linking to its page there, and the user. It's added when
the page is served, so every app has it without a rebuild. The kit's `NavBar` and `Page` use
the same metrics as vibe's own pages, so an app's navigation sits under it as a matching second row.

A bundle keeps the kit it was built with. **Rebuild with the current kit** in an app's ⋯ menu redeploys its current
files through `POST /api/apps/:id/deploy`, without Claude, so kit fixes reach older apps.

Tailwind compiles at build time, not per request, with `kit/theme.css` on top. Its compiler is plain JavaScript; only
its file scanner is native. So `lib/tailwind.ts` splits the sources into tokens and passes them all to `build()`, which ignores the ones that
aren't classes. The CSS goes into the bundle as `vibe:css` and `createApp()` inlines it.

**Sharing.** `apps.visibility` is `private`, `teams` or `everyone`. `shares` lists the teams an app is shared with.
You can share with teams you're in. Only the owner changes or redeploys an app. The owner can hand an app to someone else
(**Transfer ownership** in its ⋯ menu, `PUT /api/apps/:id/owner`), who must have signed in to vibe once, so a typo can't
lock it away. Teams are a name and member emails;
members manage their team, and can add someone before they've signed in once. Everything keys on the signed-in
user's email, so Better Auth's organizations aren't used.

**App data.** Each app isolate gets one binding, `VIBE`: `ctx.exports.default({ props: { appId, userEmail } })`. The
props are set when the isolate loads, and the app can't change them. The kit's `data.collection("todos")` sends its
calls through `VIBE` to `/internal/data`, which reads the user and app from `ctx.props` and ignores the request body's
claims. A browser request has no props and gets a 404 there.

That's why each user gets their own isolate: the binding is fixed per isolate. It also means no in-memory state is
shared between users. It costs about 3.8 MB per user per app version (below).

Why not a Durable Object facet per app, as VibeSDK does: a facet hands the app its own SQLite, so keeping users apart
and expiring their data would be up to the generated code. Here the platform enforces both, and the app never sees
another user's rows.

**Shared data.** `c.var.shared.collection("x")` has the same API on data everyone who can open the app shares (owner,
its teams, or everyone, per its sharing). It lives in the same Durable Object under the user `~shared`, which no email can
be. Shared documents carry `createdBy` and `updatedBy`, never expire, and anyone who can open the app may change them;
finer rules are the app's own, using `createdBy`. Deleting an app clears all its data.

`durable-objects/app-data.ts` is one Durable Object per app with SQLite. Every row has a `user` column, and every
query filters on it. A write moves the user's expiry to 14 days later; an alarm at the earliest expiry deletes
expired users' data, and reads skip expired data if the alarm hasn't run yet.

**Super admins.** Users whose Better Auth role is `admin` (the admin plugin in `auth.ts`, `lib/admin.ts`). They act as
the owner of every app (change, rebuild, share with any team, network, transfer, delete) and a member of every team, and
`/admin` (in the sidebar for them only) lists every app, every team and every user:

- an app's data, per space (each user's private data, and the shared data): documents, collections, expiry; browse the
  documents and delete one or a whole space (`/api/admin/apps/:id/data`). That includes users' private data.
- teams: add and remove members, delete a team.
- users: make someone a super admin or take it away, never from yourself (`/api/admin/users/:id/role`). With the session
  cookie cache a change shows within five minutes.

Everyone else gets a 404 on `/admin` and a 403 from its API. The first admin is made in D1:

```bash
pnpm exec void db execute --remote "UPDATE user SET role = 'admin' WHERE lower(email) = 'you@example.com'"
```

**Network.** Each app has a network setting on its page, changed only by its owner (`lib/outbound.ts`,
`PUT /api/apps/:id/outbound`):

- **Disabled** (the default): the isolate gets `globalOutbound: null`, so `fetch()` throws.
- **Allow list**: hosts like `api.github.com`, or `*.example.com` for subdomains, up to 20. The isolate's
  `globalOutbound` is the platform itself with props `{ outboundFor, hosts }`; `middleware/00.app-outbound.ts` fetches
  listed hosts without following redirects (the app's own `fetch()` follows them, and each hop comes back through the
  check) and answers 403 to anything else.
- **Allow all**: the internet.

The setting is part of the isolate's id, so a change applies from the next request. The smoke test runs with it, and
Claude is told it with each request ("Network: ..."), not in the cached system prompt. An app holds its users' data,
so anything but Disabled lets it send that data to the hosts it may reach.

**App pages run only vibe's script.** Apps are served from the platform's origin under `/apps/<id>/`, so a script
of an app's own could call the platform's API as whoever opened it. App responses have their `Set-Cookie` removed and
receive no cookies or Access token, and the API refuses non-JSON and cross-origin writes. Their CSP allows one
script: vibe's own, `kit/browser.js`, by its full URL (`script-src https://vibe.example.com/kit/vibe-<hash>.js`,
not `'self'`, which would cover `/apps/` too). `forward()` links it from every HTML page (`lib/vibe-script.ts`), so
apps built before it have it too.

The script gives app pages behaviour that apps declare with `data-vibe-*` attributes, through kit components:

- `<Form autosave>` POSTs the form to its own action while people type and on every change, as a submit would, then
  replaces every `<Live id>` with its copy from the page the redirect answers. `<SaveStatus>` says how it went.
- `<CopyButton target>` copies an element's text, after pending saves; without clipboard access it shows and selects it.
- `<Range>` shows its value as it moves and can set a CSS variable for a live preview; `<Chips>` radios clear when
  clicked again.
- `.vibe-no-js` hides while the script runs (a Save button), `.vibe-js` without it.

It only ever talks to the app's own URLs under `/apps/<id>/`, and posts forms, never JSON, so the API refuses it
anyway. Everything still works as plain forms without it. To allow apps' own scripts, serve them from their own
hostname first.

## Measurements

Built Worker (`dist/ssr`) in workerd through Wrangler's test harness, on an M-series Mac, 2026-11-13. Five deploys
per app; 20 warm requests after each. `pnpm measure` writes the raw data to `results/measurements.json`.

| | |
|---|---|
| Build, kit app (notes) | 480–510 ms; 826 ms for the first after a restart |
| Build with `zod` and `marked` from npm | 1.5 s |
| Bundle | 65 KB kit app (its CSS inlined), 588 KB with `zod` and `marked` |
| First request to a new version (new isolate) | 15–23 ms; 32–35 ms with `zod` and `marked` |
| Warm request | 5–6 ms median (4–19 ms) |
| First request for another user (their own isolate) | 14 ms median |
| workerd memory | 276 MB idle, 802 MB after the first builds |
| Memory per user isolate | 3.8 MB (50 users opening one app) |

The jump after the first build is esbuild's WebAssembly, about 310 MB, which stays loaded in the Builder. Generating
with Claude adds the model's time on top: each attempt is one `ai.run()` call.

One real generation (2026-11-13, "a reading list: add a book with title and author, mark it read, delete it"):
working on the first attempt. In `pnpm dev`: Claude 12.1 s, build 0.7 s, smoke 29 ms, 13.0 s from request to stored
version. Deployed, through Access: Claude 10.1 s, build 66 ms, smoke 483 ms, 13.0 s end to end.

## Surprises

- **Void's router 404s `/apps/<id>/`.** A route catches `/apps/<id>/x` but not the trailing slash an app's root
  needs. Apps are served from a middleware (`middleware/03.apps.ts`) instead of a route.
- **Compressed npm responses fail under the test harness.** worker-bundler fetches packages with `fetch()`, and in
  Wrangler's test harness workerd reports `Brotli decompression failed` (or `Gzip ...`). worker-bundler then leaves
  the package out with only a warning, and the app fails at its first request. The builder asks the registry for
  uncompressed responses and treats `Failed to install` warnings as build errors. Dev under Vite was not affected.
- **`ctx.exports` has only `default` in a Void app.** Void writes the Worker entry, so there's no named
  `WorkerEntrypoint` to hand out. The default entrypoint with props works: the app's binding reaches the platform's
  own handler, which reads `ctx.props`.
- **An `RpcTarget` can't go in a Dynamic Worker's `env`.** Only bindings can, so a per-user data object has to be a
  service binding with props, not an object.
- **The AI binding needs Cloudflare even in tests.** A Worker config with `ai` makes Wrangler's test harness start a
  remote AI proxy, which needs a login. `test/build.ts` writes `dist/ssr/wrangler.test.json` without the binding,
  and the tests set Void's HTTP proxy vars (`__VOID_PROXY_URL` and two dummies) so `void/ai` sends `ai.run()` to a
  local stub. Those vars are Void internals; check them on a Void upgrade.
- **Third-party models lose the Messages API extras.** Workers AI takes `messages`, `system`, `max_tokens`,
  `thinking`, `output_config` and tools, but no `betas`, so the server-side refusal fallback is gone. A refusal now
  ends the generation with "The model declined this request."
- **Void infers bindings from `routes/`, `middleware/`, `pages/`, `durable-objects/` and `src/`, not `lib/`.** With
  the server code in `lib/`, the AI binding would drop from the build. `void.config.ts` names AI, R2
  and D1 itself.
- **The Access plugin builds the issuer as `https://<team>.cloudflareaccess.com`.** The team domain is a name
  (`acme`), not a URL; the tests point `CF_ACCESS_CERTS_URL` at their own key server and sign with that issuer.
- **`pnpm dev` needs an interactive login for the remote AI binding.** Void always runs Workers AI remotely in dev,
  through a preview Worker on your account. If that account's `workers.dev` is behind Access, a non-interactive
  shell stops with "no Access Service Token credentials were found". Run it from a terminal.
- **Nuxt UI's Vue plugin can't be installed.** Void creates the Vue app itself, with no hook for `app.use()`. The
  layout registers the bundled icons itself, and `src/app.css` sets the color variables the plugin would write
  into `<head>`. `#app` gets `isolation: isolate`, or modals and slideovers draw under the sticky top bar.
- **The session middleware must let `/assets/` through.** Otherwise signed-out pages lose their CSS and scripts to
  the sign-in redirect.

From the earlier [dynamic-workers-platform](https://github.com/mikepage/dynamic-workers-platform) lab, still true:
unresolved imports deploy silently (hence the import check), JSX needs `jsxImportSource: "hono/jsx"`, and `.css`
needs `loader: { ".css": "text" }`.

## Deploying it

`void deploy`, to a Custom Domain on your Cloudflare account. Set your hostname in `void.config.ts` (`routes`); it says
`vibe.example.com` here.

1. Access: a self-hosted application on that hostname with an Allow policy for the people who may use it and no
   bypass policies. `workers_dev` and preview URLs are off, so Access is the only way in.
2. Secrets: `void secret put CF_ACCESS_TEAM_DOMAIN=<your team>` (the `<team>` of `<team>.cloudflareaccess.com`),
   `CF_ACCESS_AUD=<the app's AUD tag>` and `BETTER_AUTH_SECRET=$(openssl rand -base64 32)`.
3. Unified Billing credits on the account pay for Claude. No AI secrets.
4. `void deploy`. It provisions D1, R2 and the two Durable Objects and applies the migrations. Its readiness check goes
   through the Custom Domain, so it needs an Access session:

```bash
cloudflared access login https://vibe.example.com
CF_ACCESS_READINESS_ORIGIN=https://vibe.example.com CF_ACCESS_TOKEN="$(cloudflared access token --app=https://vibe.example.com)" pnpm exec void deploy
```

## Layout

| Path | What |
|---|---|
| `auth.ts` | Better Auth with the Cloudflare Access plugin |
| `middleware/` | Allow-listed apps' outbound gateway (00.app-outbound), Access (00), session and sign-in redirects (01), API write checks (02), app serving and vibe's script (03) |
| `pages/` | Vue pages on Nuxt UI in one shell (`layout.vue`: sidebar, breadcrumb, user menu): apps (`index`), one app (`build/[id]`: a workspace, the conversation and queued changes beside the draft or live app in a frame, details in a slideover), `teams`, `admin/` (apps, app data, teams, users), local `sign-in` and `sign-up` |
| `routes/` | JSON API (`api/`), the apps' data endpoint (`internal/data.ts`) |
| `durable-objects/` | `builder.ts` (worker-bundler), `app-data.ts` (per-app SQLite) |
| `lib/` | Apps and sharing, teams, checks, build, Tailwind, Claude loop and prompt, runtime, the Access plugin and its options |
| `src/` | The pages' parts: `app.css` (Tailwind, Nuxt UI, the collapsed sidebar), `components/` (sidebar nav, admin tabs, dialogs, user menu), `nav.ts`, `sidebar.ts`, `theme.ts`, and the API helper |
| `kit/` | The components, theme and `createApp()` every app imports as `vibe:app` |
| `db/` | Drizzle schema and migrations (Better Auth's tables are generated by Void) |
| `test/` | Tests against the built Worker, and the Access plugin on its own |
| `tools/lint/` | ESLint on TypeScript 6 |
| `.changeset/` | Changesets: a change someone can notice gets one |
| `examples/notes` | A hand-written kit app |
