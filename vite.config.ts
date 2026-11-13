import ui from "@nuxt/ui/vite"
import { voidVue } from "@void/vue/plugin"
import { defineConfig } from "vite"
import { voidPlugin } from "void"

// Void builds and serves the Worker; @void/vue renders pages/ on the server
// and hydrates them. The Worker itself is described in void.config.ts.
//
// Nuxt UI in plain Vue, through its Vite plugin: it adds Tailwind, imports its
// components (U*) where pages use them, and bundles the Lucide icons they name
// (no requests to Iconify). Void routes, not vue-router, so its links are plain
// anchors. Light and dark are vibe's own (src/theme.ts), on Nuxt UI's `.dark`.
export default defineConfig({
  plugins: [
    voidPlugin(),
    voidVue(),
    ui({
      router: false,
      colorMode: false,
      dts: false,
      autoImport: false,
      ui: { colors: { primary: "green", neutral: "slate" } },
      icon: { clientBundle: { scan: true } },
    }),
  ],
  resolve: { dedupe: ["vue"] },
  // Fixed, so local sign-in cookies and the launch config agree.
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", minify: true },
})
