# vibe

A Void app: Vue pages on Nuxt UI (plain Vue through `@nuxt/ui/vite`, not Nuxt),
sign-in through Cloudflare Access (`lib/cloudflare-access-plugin.ts`) on Void's
Better Auth. Claude writes apps through the Workers AI binding, worker-bundler
builds them, Worker Loader runs each one.

**Deploy with `void deploy`**, after Mike says so. The hostname is in
`void.config.ts`; the readiness check needs an Access session (README,
"Deploying it"); a new Durable Object migration needs `--atomic`.

**A change someone can notice gets a changeset**, in the same commit:
`pnpm changeset`. Not for refactors, tests or tooling.

**Check before pushing:** `pnpm lint`, `pnpm check` and `pnpm test`.

**House rules:**

- Exact versions everywhere. Let Void own the Cloudflare toolchain versions.
- No organizations: sharing is vibe's own (private, teams, everyone in
  `lib/apps.ts`), keyed on the session user's email (`me()` in `lib/http.ts`).
- Deployed, Cloudflare Access is the only way in: `workers_dev` and preview URLs
  off, no Access bypass policies, no public routes. Only an app's `VIBE` binding
  (props set by `lib/runtime.ts`) passes `middleware/00.cloudflare-access.ts`
  without a token.
- The Access plugin verifies tokens with WebCrypto (`crypto.subtle`). No JWT
  library. Its tests are `test/cloudflare-access.test.ts`.
- Nuxt UI first on the pages: a `U*` component (auto-imported), else Tailwind
  classes on Nuxt UI's tokens (`text-muted`, `bg-elevated`, `border-default`),
  else `src/app.css`. Icons are Lucide (`i-lucide-*`), bundled at build time.
  Internal links use Void's `Link`, so navigation doesn't reload.
- Nuxt UI's Vue plugin isn't installed (Void creates the app): the layout
  registers the icons, `src/app.css` holds the color variables. A new color in
  `vite.config.ts` needs its variables there too.
- The kit (`kit/`) is what generated apps import as `vibe:app`. Apps can't run
  scripts, so it's Hono JSX with Tailwind classes drawn like Nuxt UI, on the
  tokens in `kit/theme.css`. Change its API or look only with the prompt
  (`lib/prompt.ts`), which includes its source.
- Import Drizzle through `void/db` and `void/schema-d1`, not `drizzle-orm`.
- After changing `db/schema.ts` or `auth.ts`: `pnpm db:generate`, then commit
  the migration.
- Void doesn't infer bindings from `lib/`: a new binding used only there goes in
  `void.config.ts`.
