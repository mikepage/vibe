// vibe's top bar on app pages, as on the platform's own pages: home and "Apps" back to vibe,
// the app's name (its page there), and who is signed in. lib/runtime.ts adds it to every HTML
// page an app answers, whichever kit the app was built with, so no app needs a rebuild for
// it. The kit's NavBar sits under it as a matching second row. Its CSS is on Nuxt UI's tokens
// (kit/theme.css, in the app's CSS), with fallbacks for a page without them; no external
// logo, as app pages only load images from vibe's origin.

export const TOPBAR_CSS = `.vibe-topbar{display:flex;align-items:center;gap:.75rem;min-height:3.5rem;padding:.5rem 1.5rem;border-bottom:1px solid var(--ui-border,#e2e8f0);background:var(--ui-bg,#fff);font-family:system-ui,sans-serif}
.vibe-crumbs{display:flex;align-items:center;gap:.5rem;flex:1;min-width:0;margin:0;padding:0;list-style:none;font-size:.875rem;font-weight:500}
.vibe-crumbs li{display:flex;align-items:center;gap:.5rem;min-width:0}
.vibe-crumbs a{color:var(--ui-text-muted,#62748e);text-decoration:none;white-space:nowrap}
.vibe-crumbs a:hover{color:var(--ui-text-highlighted,#0f172b)}
.vibe-crumbs .vibe-home{display:flex;color:var(--ui-text-muted,#62748e)}
.vibe-crumbs .vibe-current{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-text-highlighted,#0f172b)}
.vibe-crumbs svg{flex-shrink:0}
.vibe-sep{color:var(--ui-text-dimmed,#90a1b9)}
.vibe-draft{flex-shrink:0;padding:.125rem .5rem;border-radius:9999px;background:color-mix(in oklab,var(--ui-warning,#f0b100) 10%,transparent);color:#a65f00;font-size:.75rem;font-weight:600}
.vibe-user{display:flex;align-items:center;gap:.5rem;font-size:.875rem;font-weight:500;color:var(--ui-text,#314158)}
.vibe-avatar{display:grid;place-items:center;width:1.5rem;height:1.5rem;border-radius:9999px;background:var(--ui-bg-elevated,#f1f5f9);color:var(--ui-text-toned,#45556c);font-size:.625rem;font-weight:600}
@media (max-width:40rem){.vibe-user .vibe-email{display:none}.vibe-topbar{padding-inline:1rem}}`;

const HOME = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10.7 2.3a1 1 0 0 0-1.4 0l-7 7A1 1 0 0 0 3 11h1v6a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-6h1a1 1 0 0 0 .7-1.7z"/></svg>`;
const SEP = `<svg class="vibe-sep" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M7 3l7 7-7 7"/></svg>`;

const escape = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Links open in the whole window, so they leave the draft preview's frame on vibe's build page. */
export function topBar(appId: string, appName: string, email: string, draft = false): string {
  const initials = escape(email.slice(0, 2).toUpperCase());
  return `<header class="vibe-topbar"><nav aria-label="Breadcrumb" style="flex:1;min-width:0"><ol class="vibe-crumbs">`
    + `<li><a href="/" target="_top" class="vibe-home">${HOME}<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Vibe</span></a></li>`
    + `<li>${SEP}<a href="/" target="_top">Apps</a></li>`
    + `<li>${SEP}<a href="/build/${escape(appId)}" class="vibe-current" aria-current="page" target="_top">${escape(appName || appId)}</a></li>`
    + (draft ? `<li><span class="vibe-draft">Draft</span></li>` : "")
    + `</ol></nav><span class="vibe-user"><span class="vibe-avatar" aria-hidden="true">${initials}</span><span class="vibe-email">${escape(email)}</span></span></header>`;
}

/**
 * The page with the top bar's CSS in its <head> and the bar right after <body>. Once: a page
 * that has one keeps it.
 */
export function withTopBar(html: string, app: { id: string; name: string; draft?: boolean }, email: string): string {
  if (html.includes('class="vibe-topbar"')) return html;
  return html
    .replace("</head>", `<style>${TOPBAR_CSS}</style></head>`)
    .replace(/<body[^>]*>/, (body) => body + topBar(app.id, app.name, email, app.draft));
}
