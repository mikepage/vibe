// ESLint for the app (`pnpm lint` at the root): the recommended
// rules for JavaScript and TypeScript, no type-aware ones (`pnpm check` runs
// tsc). Vue files are type-checked by the build, not linted.
import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["**/node_modules/**", ".claude/**", "dist/**", ".void/**", ".wrangler/**", ".cloudflare/**", "db/migrations/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Code runs in Node (configs, tests) and workerd.
    languageOptions: { globals: { ...globals.node, ...globals.serviceworker } },
    rules: {
      // Generic code over Hono and Better Auth types needs `any` in places;
      // strict tsc still checks everything around it.
      "@typescript-eslint/no-explicit-any": "off",
      // A leading underscore marks a deliberately unused name, and rest
      // siblings drop keys from an object.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // vibe's script for app pages runs in the browser.
  { files: ["kit/browser.js"], languageOptions: { globals: globals.browser } },
)
