import { DurableObject } from "cloudflare:workers";
import { defineDurableObject } from "void/durable";
import { buildApp } from "../lib/build.ts";
import type { Files } from "../lib/checks.ts";

// One builder for the platform. It keeps esbuild warm between builds and keeps its
// memory apart from the Worker isolates that serve the platform and the apps.
class BuilderObject extends DurableObject {
  build(files: Files) {
    return buildApp(files);
  }
}

export const Builder = defineDurableObject({ name: "builder", class: BuilderObject });
export default Builder;
