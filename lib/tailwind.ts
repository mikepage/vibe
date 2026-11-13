// Tailwind v4 at build time, inside the Worker. The compiler is plain JavaScript; only its
// file scanner (Oxide) is native. So we scan the sources ourselves: every token that could
// be a class name goes to build(), and Tailwind ignores the ones that aren't.

import { compile } from "tailwindcss";
import indexCss from "tailwindcss/index.css?raw";
import preflightCss from "tailwindcss/preflight.css?raw";
import themeCss from "tailwindcss/theme.css?raw";
import utilitiesCss from "tailwindcss/utilities.css?raw";
import kitTheme from "../kit/theme.css?raw";

const SHEETS: Record<string, string> = {
  tailwindcss: indexCss,
  "tailwindcss/theme": themeCss,
  "tailwindcss/theme.css": themeCss,
  "tailwindcss/preflight": preflightCss,
  "tailwindcss/preflight.css": preflightCss,
  "tailwindcss/utilities": utilitiesCss,
  "tailwindcss/utilities.css": utilitiesCss,
};

// Tailwind, then Nuxt UI's tokens (kit/theme.css), so text-muted or bg-primary work in apps.
const STYLESHEET = `@import "tailwindcss";\n${kitTheme}`;

// Splits source text on what can't be part of a class name: whitespace, quotes,
// backticks, braces, angle brackets, semicolons, and commas outside [...] and (...),
// so `grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]` stays one token.
const SEPARATOR = /[\s"'`{}<>;]/;

function tokens(source: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= source.length; i++) {
    const ch = source[i];
    if (ch === "[" || ch === "(") depth++;
    else if ((ch === "]" || ch === ")") && depth > 0) depth--;
    else if (ch === undefined || SEPARATOR.test(ch) || (ch === "," && depth === 0)) {
      if (i > start) out.push(source.slice(start, i));
      start = i + 1;
      depth = 0;
    }
  }
  return out;
}

export function candidates(sources: string[]): string[] {
  const out = new Set<string>();
  for (const source of sources) {
    for (const token of tokens(source)) {
      if (token.length < 120 && /[a-z]/.test(token)) out.add(token);
    }
  }
  return [...out];
}

/** The CSS for exactly the classes in `sources`. A fresh compiler each time: build() remembers every candidate it has seen. */
export async function compileCss(sources: string[]): Promise<string> {
  const compiler = await compile(STYLESHEET, {
    base: "/",
    loadStylesheet: async (id: string) => {
      const content = SHEETS[id];
      if (content === undefined) throw new Error(`@import "${id}" is not available`);
      return { path: id, base: "/", content };
    },
  });
  return compiler.build(candidates(sources));
}
