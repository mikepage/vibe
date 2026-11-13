// Builds an app's files into one module for Worker Loader. Runs in the Builder Durable
// Object, so esbuild's WebAssembly (about 310 MB once loaded) stays out of the isolates
// that serve requests.

import { createWorker } from "@cloudflare/worker-bundler";
import kitApp from "../kit/app.tsx?raw";
import kitComponents from "../kit/components.tsx?raw";
import { BuildError, checkFiles, type Files } from "./checks.ts";
import { compileCss } from "./tailwind.ts";

export type Bundle = { mainModule: string; modules: Record<string, string | Record<string, unknown>> };
export type Built = Bundle & { buildMs: number; cssMs: number; bytes: number; hash: string; warnings: string[] };
export type BuildResult = { ok: true; built: Built } | { ok: false; error: string };

const KIT_FILES = { "_vibe/components.tsx": kitComponents, "_vibe/app.tsx": kitApp };

export async function hashOf(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// worker-bundler downloads packages from the npm registry with fetch(). Under Wrangler's
// test harness every compressed registry response fails to decode ("Brotli decompression
// failed", "Gzip decompression failed"), and the bundler then leaves the package out.
// Asking for uncompressed responses works everywhere; tarballs are gzip files anyway.
const REGISTRY = "https://registry.npmjs.org/";
let patched = false;
function uncompressedRegistry() {
  if (patched) return;
  patched = true;
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(REGISTRY)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("accept-encoding", "identity");
    return original(input, { ...init, headers });
  };
}

export async function buildApp(files: Files): Promise<BuildResult> {
  uncompressedRegistry();
  try {
    const { entryPoint, packageJson } = checkFiles(files);
    const start = performance.now();

    const sources = [...Object.entries(files).filter(([n]) => /\.(tsx?|jsx?)$/.test(n)).map(([, s]) => s), kitComponents];
    const css = await compileCss(sources);
    const cssMs = performance.now() - start;

    const result = await createWorker({
      files: { ...files, "package.json": packageJson, ...KIT_FILES },
      entryPoint,
      // esbuild defaults to React's classic JSX; apps use Hono's.
      jsx: "automatic",
      jsxImportSource: "hono/jsx",
      // `import css from "./app.css"` gives the text, for a Worker that serves it.
      loader: { ".css": "text" },
      virtualModules: {
        "vibe:app": `export * from "/_vibe/components.tsx";\nexport * from "/_vibe/app.tsx";`,
        "vibe:css": `export default ${JSON.stringify(css)};`,
      },
      minify: true,
    });
    const failed = (result.warnings ?? []).filter((w) => w.startsWith("Failed to install"));
    if (failed.length) return { ok: false, error: failed.join("\n") };
    const bundle: Bundle = { mainModule: result.mainModule, modules: result.modules as Bundle["modules"] };
    const bytes = new TextEncoder().encode(JSON.stringify(bundle.modules)).length;
    return {
      ok: true,
      built: {
        ...bundle,
        buildMs: Math.round(performance.now() - start),
        cssMs: Math.round(cssMs),
        bytes,
        hash: await hashOf(bundle),
        warnings: result.warnings ?? [],
      },
    };
  } catch (e) {
    if (e instanceof BuildError) return { ok: false, error: e.message };
    // esbuild reports syntax and resolution errors as exceptions too; the model can fix those.
    return { ok: false, error: `build failed: ${(e as Error).message}` };
  }
}
