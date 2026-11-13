// What must hold before a build. worker-bundler marks an import it can't resolve as
// external and builds anyway, so a missing package would only show up when the app
// starts. These checks turn that into an error the model can fix.

export type Files = Record<string, string>;

export class BuildError extends Error {}

export const ENTRY_FILES = ["index.tsx", "index.ts"];
export const HONO_VERSION = "4.13.18";

const CODE = /\.(ts|tsx|js|jsx)$/;
const IMPORT =
  /(?:(?<![\w$.@])import\s*(?:[\w*{}\s,$]+\s*from\s*)?|(?<![\w$.@])export\s*[\w*{}\s,$]+\s*from\s*|(?<![\w$.@])import\s*\(\s*)["']([^"']+)["']/g;

/** Returns the entry file and the package.json to build with, or throws a BuildError. */
export function checkFiles(files: Files): { entryPoint: string; packageJson: string } {
  const names = Object.keys(files);
  if (names.length === 0) throw new BuildError("no files");
  for (const name of names) {
    if (name.startsWith("_vibe/") || name.startsWith("/") || name.includes("..")) {
      throw new BuildError(`${name}: file names must be relative and can't start with _vibe/`);
    }
  }
  const entryPoint = ENTRY_FILES.find((f) => f in files);
  if (!entryPoint) throw new BuildError(`add ${ENTRY_FILES.join(" or ")}`);

  let pkg: { dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(files["package.json"] ?? "{}");
  } catch (e) {
    throw new BuildError(`package.json: ${(e as Error).message}`);
  }
  // Every app gets the kit's Hono, whatever package.json says.
  const dependencies = { ...pkg.dependencies, hono: HONO_VERSION };

  const missing = new Set<string>();
  for (const [name, source] of Object.entries(files)) {
    if (!CODE.test(name)) continue;
    for (const [, spec] of source.matchAll(IMPORT)) {
      if (spec.startsWith(".") || spec === "vibe:app" || spec.startsWith("cloudflare:")) continue;
      if (spec.startsWith("node:")) {
        missing.add(`${spec} (imported in ${name}; apps run without Node.js APIs)`);
        continue;
      }
      const parts = spec.split("/");
      const pkgName = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!(pkgName in dependencies)) missing.add(`${pkgName} (imported in ${name})`);
    }
  }
  if (missing.size) throw new BuildError(`not in package.json dependencies: ${[...missing].join(", ")}`);
  return { entryPoint, packageJson: JSON.stringify({ ...pkg, dependencies }) };
}
