import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    compatibility_date: "2026-11-01",
    compatibility_flags: ["nodejs_compat"],
  },
  routing: { isr: false },
  head: {
    title: "Vibe",
    meta: [{ charset: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
  },
  cloudflare: {
    name: "vibe",
    // Runs each generated app as a Dynamic Worker.
    worker_loaders: [{ binding: "LOADER" }],
    // Only reachable through Cloudflare Access on your own hostname.
    routes: [{ pattern: "vibe.example.com", custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
    // Void infers bindings from routes/, middleware/, pages/ and durable-objects/,
    // not lib/: Claude (lib/generate.ts, void/ai) and app sources and bundles
    // (lib/apps.ts, void/storage) are named here. The names are the ones the
    // first deploy provisioned (void.lock.json).
    ai: { binding: "AI" },
    r2_buckets: [{ binding: "STORAGE", bucket_name: "vibe-storage" }],
    d1_databases: [{ binding: "DB", database_name: "vibe-db", migrations_dir: "db/migrations" }],
  },
});
