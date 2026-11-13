// vibe's script for app pages (kit/browser.js): the only script an app page may run. The
// CSP in lib/runtime.ts allows exactly this path, and forward() links it from every HTML
// page an app answers, so apps built before it have it too. The path carries a hash of the
// file, so browsers keep it for good and a change reaches them at once.
import source from "../kit/browser.js?raw";

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const VIBE_SCRIPT_PATH = `/kit/vibe-${fnv1a(source)}.js`;

/**
 * What hides .vibe-js without the script and .vibe-no-js with it. Also: a table lets an open
 * <details> in it overflow, so apps that drop a panel down from a row (before the kit had
 * Popover) aren't cut off by the table's scroll box. On every app page, so no rebuild needed.
 */
export const VIBE_SCRIPT_CSS =
  "html:not([data-vibe]) .vibe-js,html[data-vibe] .vibe-no-js{display:none!important}" +
  ".vibe-table:has(details[open]){overflow:visible}";

export const vibeScript = () =>
  new Response(source, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, max-age=31536000, immutable" } });

/** The page with the script and its CSS in <head>. */
export function withVibeScript(html: string): string {
  if (html.includes(VIBE_SCRIPT_PATH)) return html;
  return html.replace("</head>", `<style>${VIBE_SCRIPT_CSS}</style><script src="${VIBE_SCRIPT_PATH}" defer></script></head>`);
}
